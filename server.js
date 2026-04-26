import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality } from "@google/genai";

const PORT = process.env.PORT || 8080;

/* =========================
   MOODLE REST (Railway)
   ========================= */

const MOODLE_BASE_URL = process.env.MOODLE_BASE_URL; // ej: https://myteam.tizapp.fun
const MOODLE_WSTOKEN = process.env.MOODLE_WSTOKEN;   // token MTBP_EVAL (sin caducidad)
const EVAL_API_KEY = process.env.EVAL_API_KEY;       // opcional (recomendado)

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-api-key",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
}

function json(res, status, obj) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(),
  });
  res.end(JSON.stringify(obj));
}

function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[–—−]/g, "-")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (ch) => (raw += ch));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

async function moodleCall(wsfunction, paramsObj) {
  if (!MOODLE_BASE_URL || !MOODLE_WSTOKEN) {
    throw new Error("Faltan MOODLE_BASE_URL o MOODLE_WSTOKEN en Railway");
  }

  const url = `${MOODLE_BASE_URL}/webservice/rest/server.php`;

  const body = new URLSearchParams({
    wstoken: MOODLE_WSTOKEN,
    wsfunction,
    moodlewsrestformat: "json",
  });

  for (const [k, v] of Object.entries(paramsObj || {})) {
    body.append(k, String(v));
  }

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await r.json();

  if (data && data.exception) {
    throw new Error(`${data.exception}: ${data.message || "Error Moodle WS"}`);
  }
  return data;
}

/* =========================
   HTTP SERVER
   ========================= */

const server = http.createServer(async (req, res) => {
  try {
    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      return res.end();
    }

    const url = new URL(req.url || "/", "http://localhost");

    // Solo protegemos endpoints /moodle/*
    if (url.pathname.startsWith("/moodle/")) {
      // Seguridad opcional: x-api-key
      if (EVAL_API_KEY) {
        const apiKey = req.headers["x-api-key"];
        if (apiKey !== EVAL_API_KEY) {
          return json(res, 401, { ok: false, error: "Unauthorized (x-api-key)" });
        }
      }

      // Health
      if (req.method === "GET" && url.pathname === "/moodle/health") {
        return json(res, 200, { ok: true, service: "moodle-bridge" });
      }

      // Buscar assignId por nombre en un curso
      if (req.method === "GET" && url.pathname === "/moodle/assign-id") {
        const courseId = url.searchParams.get("courseId");
        const name = url.searchParams.get("name");

        if (!courseId || !name) {
          return json(res, 400, { ok: false, error: "Faltan courseId o name" });
        }

        const target = normalizeName(name);

        const data = await moodleCall("mod_assign_get_assignments", {
          "courseids[0]": courseId,
        });

        const course = (data?.courses || []).find(
          (c) => String(c.id) === String(courseId)
        );

        const assigns = course?.assignments || [];
        const found = assigns.find((a) => normalizeName(a.name) === target);

        if (!found) {
          return json(res, 404, {
            ok: false,
            error: "No encontré esa tarea en el curso",
            searched: name,
            courseId,
            available: assigns.map((a) => ({ id: a.id, name: a.name })),
          });
        }

        return json(res, 200, { ok: true, assignId: found.id, name: found.name });
      }

      // Guardar nota + feedback (boletín)
      if (req.method === "POST" && url.pathname === "/moodle/grade") {
        const body = await readJsonBody(req);

        const assignId = body.assignId;
        const parentEmail = body.parentEmail;
        const grade = body.grade; // 1..5
        const feedback = body.feedback || "";

        if (!assignId || !parentEmail || grade == null) {
          return json(res, 400, {
            ok: false,
            error: "Faltan assignId, parentEmail o grade",
          });
        }

        // Buscar user por email
        const users = await moodleCall("core_user_get_users_by_field", {
          field: "email",
          "values[0]": parentEmail,
        });

        if (!Array.isArray(users) || users.length === 0) {
          return json(res, 404, {
            ok: false,
            error: "No existe ese email en Moodle",
            parentEmail,
          });
        }

        const userId = users[0].id;

        // Guardar calificación + comentario
        const result = await moodleCall("mod_assign_save_grade", {
          assignmentid: assignId,
          userid: userId,
          grade: grade,
          attemptnumber: -1,
          addattempt: 0,
          "plugindata[assignfeedbackcomments_editor][text]": feedback,
          "plugindata[assignfeedbackcomments_editor][format]": 0,
        });

        return json(res, 200, { ok: true, result, assignId, userId });
      }

      // Endpoint no encontrado
      return json(res, 404, { ok: false, error: "Not found" });
    }

    // Respuesta simple para el root (útil para verificar que está vivo)
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("OK");
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message });
  }
});

/* =========================
   GEMINI LIVE (WS)
   ========================= */

const wss = new WebSocketServer({ server });

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { apiVersion: "v1beta" },
});

function fallbackItemsForTopic(topic) {
  if (topic === "Frases de la semana") return ["Good morning"];
  if (topic === "Práctica de vocabulario de My Book")
    return ["Yellow", "Red", "Blue", "Green"];
  return ["Good morning"];
}

function buildPrompt(topic, items) {
  const safeItems =
    Array.isArray(items) && items.length > 0 ? items : fallbackItemsForTopic(topic);

  const contentList = safeItems.map((item) => `- ${item}`).join("\n");

  return `
Eres la Coach oficial de My Team Bilingual Process.

REGLAS GENERALES:
- Hablas SIEMPRE en español.
- SOLO usas inglés para modelar la palabra o frase objetivo.
- Trabajas UN ítem por vez.
- No cambias de tema.
- No agregas palabras o frases fuera de la lista.
- Si el estudiante pregunta otra cosa, responde: "En este training practicamos solo estas palabras" y vuelve al ítem actual.
- Nunca uses la frase de cierre como ejemplo durante el entrenamiento. Solo al final.

TONO (OBLIGATORIO):
- Eres animada, empática y pedagógica.
- Sonríes con la voz y mantienes energía positiva.
- Corriges con cariño pero con firmeza.
- Celebras los logros sin exagerar.

MODO DE ENTRENAMIENTO (siempre):
- Antes de cada ítem dices exactamente: "repeat after me".
- Luego pronuncias la palabra o frase en inglés.
- Luego te callas y esperas al estudiante.
- Das feedback breve en español (1 frase).
- Nunca avances automáticamente.

PROTECCIÓN FRASE FINAL (OBLIGATORIA):
- La frase "Well done and see you in the next training" NO es un ítem de práctica.
- NUNCA pidas al estudiante que la repita.

TEMA ACTUAL:
${topic}

LISTA OFICIAL DE ESTA SESIÓN:
${contentList}

CIERRE (OBLIGATORIO):
Cuando termines TODA la lista, debes cerrar SIEMPRE diciendo esta frase exacta al final:
"Well done and see you in the next training"
Esa debe ser tu última frase. Después no sigues hablando.
`;
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectFinalClosing(text) {
  const normalized = normalizeText(text);
  return (
    normalized.includes("well done and see you in the next training") ||
    normalized.includes("see you in the next training")
  );
}

/**
 * 🔥 MAPA DE SCOPES POR PIN (backend)
 * Hoy piloto: PIN_DOCENTE => CO / J1 (Miska Muska)
 */
function scopeForPin(pin) {
  if (pin === String(process.env.PIN_DOCENTE || "")) {
    return {
      countryId: "CO",
      gardenId: "J1",
      allowedGrades: ["PARVULOS", "CAMINADORES", "PREJARDIN", "JARDIN", "TRANSICION"],
    };
  }
  return null;
}

server.listen(PORT, () => {
  console.log("backend ready");
});

wss.on("connection", (ws) => {
  console.log("🟢 CLIENTE CONECTADO");

  let session = null;
  let ready = false;
  let topic = "Frases de la semana";
  let items = fallbackItemsForTopic(topic);

  let transcriptBuffer = "";
  let pendingCloseAfterTurn = false;
  let closeTriggered = false;
  let keepAliveInterval = null;
  let googleClosed = false;
  let initialInstructionSent = false;

  function triggerSessionEnd() {
    if (closeTriggered) return;
    closeTriggered = true;
    pendingCloseAfterTurn = false;

    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "sessionEnded" }));
    }

    setTimeout(() => {
      try {
        if (ws.readyState === ws.OPEN) ws.close(1000, "training completed");
      } catch {}
    }, 900);
  }

  function sendInitialInstructionIfReady() {
    if (initialInstructionSent) return;
    if (!ready || !session) return;

    initialInstructionSent = true;

    session.sendRealtimeInput({
      text:
        "Saluda en español, preséntate como la Coach de My Team, pregunta el nombre del estudiante, espera su respuesta y luego empieza a practicar la lista oficial, un ítem por vez, dando feedback en español.",
    });
  }

  function startGeminiSession() {
    ready = false;
    transcriptBuffer = "";
    pendingCloseAfterTurn = false;
    closeTriggered = false;
    googleClosed = false;
    initialInstructionSent = false;

    ai.live
      .connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Kore" },
            },
          },
          systemInstruction: { parts: [{ text: buildPrompt(topic, items) }] },
        },
        callbacks: {
          onmessage: (msg) => {
            try {
              if (msg.setupComplete) {
                ready = true;
                if (ws.readyState === ws.OPEN)
                  ws.send(JSON.stringify({ type: "readyForUser" }));
                sendInitialInstructionIfReady();
                return;
              }

              const transcriptChunk = msg.outputTranscription?.text;
              if (typeof transcriptChunk === "string" && transcriptChunk.trim()) {
                transcriptBuffer += " " + transcriptChunk.trim();
                if (detectFinalClosing(transcriptBuffer)) pendingCloseAfterTurn = true;
              }

              const parts = msg.serverContent?.modelTurn?.parts;
              if (parts?.length) {
                for (const p of parts) {
                  if (p.inlineData?.data && ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({ type: "audio", audio: p.inlineData.data }));
                  }
                }
              }

              if (msg.serverContent?.turnComplete) {
                if (pendingCloseAfterTurn) {
                  triggerSessionEnd();
                  return;
                }
                transcriptBuffer = "";
                if (ws.readyState === ws.OPEN)
                  ws.send(JSON.stringify({ type: "turnComplete" }));
              }
            } catch (err) {
              console.error("❌ ERROR MENSAJE:", err);
            }
          },

          onclose: (e) => {
            googleClosed = true;
            if (pendingCloseAfterTurn && !closeTriggered) triggerSessionEnd();
            if (ws.readyState === ws.OPEN) ws.close();
          },

          onerror: (err) => {
            console.error("🔴 ERROR GEMINI:", err);
            if (ws.readyState === ws.OPEN)
              ws.send(JSON.stringify({ type: "error", message: "error gemini" }));
          },
        },
      })
      .then((s) => {
        session = s;
        sendInitialInstructionIfReady();
        keepAliveInterval = setInterval(() => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "ping" }));
        }, 15000);
      })
      .catch((err) => {
        console.error("❌ ERROR INICIANDO:", err);
        if (ws.readyState === ws.OPEN)
          ws.send(JSON.stringify({ type: "error", message: "no se pudo iniciar gemini" }));
      });
  }

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      // ✅ PIN ÚNICO: devuelve scope
      if (msg.type === "checkTeacherPin") {
        const pin = String(msg.pin || "");
        const scope = scopeForPin(pin);
        const ok = !!scope;

        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "pinResult", ok, scope }));
        }
        return;
      }

      // ✅ SESIÓN VOZ
      if (msg.type === "startSession") {
        topic = msg.topic || "Frases de la semana";
        items =
          Array.isArray(msg.items) && msg.items.length > 0
            ? msg.items
            : fallbackItemsForTopic(topic);
        startGeminiSession();
        return;
      }

      if (msg.type === "audio") {
        if (!ready || !session) return;
        if (closeTriggered) return;

        session.sendRealtimeInput({
          audio: { data: msg.audio, mimeType: "audio/pcm;rate=16000" },
        });
      }
    } catch (err) {
      console.error("❌ ERROR CLIENT MESSAGE:", err);
    }
  });

  ws.on("close", () => {
    console.log("🔴 CLIENT CLOSED");

    if (keepAliveInterval) clearInterval(keepAliveInterval);

    if (session && !googleClosed) {
      try {
        session.close();
      } catch {}
    }

    session = null;
    ready = false;
  });
});
