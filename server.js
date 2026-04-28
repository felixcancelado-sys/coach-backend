import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality } from "@google/genai";
import pg from "pg";

const { Pool } = pg;

const PORT = process.env.PORT || 8080;

/* =========================
   MOODLE REST (Railway)
   ========================= */

const MOODLE_BASE_URL = process.env.MOODLE_BASE_URL; // ej: https://myteam.tizapp.fun
const MOODLE_WSTOKEN = process.env.MOODLE_WSTOKEN; // token MTBP_EVAL
const EVAL_API_KEY = process.env.EVAL_API_KEY; // opcional
const DATABASE_URL = process.env.DATABASE_URL;

/* =========================
   POSTGRES / REPORT CARDS
   ========================= */

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
    })
  : null;

// Respaldo temporal si DATABASE_URL no existe.
// En Railway producción debe usarse Postgres.
const MEMORY_REPORT_CARDS = new Map();

async function initReportCardsTable() {
  if (!pool) {
    console.warn("⚠️ DATABASE_URL no existe. Usando memoria temporal para report cards.");
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS report_cards (
      report_id TEXT PRIMARY KEY,
      report JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  console.log("✅ report_cards table ready");
}

async function saveReportCard(reportId, report) {
  const savedReport = {
    ...report,
    reportId,
    updatedAtISO: new Date().toISOString(),
  };

  if (!pool) {
    MEMORY_REPORT_CARDS.set(reportId, savedReport);
    return savedReport;
  }

  await pool.query(
    `
    INSERT INTO report_cards (report_id, report, created_at, updated_at)
    VALUES ($1, $2::jsonb, NOW(), NOW())
    ON CONFLICT (report_id)
    DO UPDATE SET
      report = EXCLUDED.report,
      updated_at = NOW();
    `,
    [reportId, JSON.stringify(savedReport)]
  );

  return savedReport;
}

async function getReportCard(reportId) {
  if (!pool) {
    return MEMORY_REPORT_CARDS.get(reportId) || null;
  }

  const result = await pool.query(
    `SELECT report FROM report_cards WHERE report_id = $1 LIMIT 1;`,
    [reportId]
  );

  return result.rows[0]?.report || null;
}

/* =========================
   HELPERS
   ========================= */

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

function detectFinalClosing(text) {
  const t = normalizeName(text);
  return t.includes("well done and see you in the next training");
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
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      return res.end();
    }

    const url = new URL(req.url || "/", "http://localhost");

    /* =========================
       REPORT CARDS / BOLETINES
       ========================= */

    if (req.method === "GET" && url.pathname.startsWith("/report-card/")) {
      const reportId = decodeURIComponent(
        url.pathname.replace("/report-card/", "")
      );

      if (!reportId) {
        return json(res, 400, {
          ok: false,
          error: "Falta reportId",
        });
      }

      const report = await getReportCard(reportId);

      if (!report) {
        return json(res, 404, {
          ok: false,
          error: "Boletín no encontrado",
          reportId,
        });
      }

      return json(res, 200, {
        ok: true,
        report,
      });
    }

    if (req.method === "POST" && url.pathname === "/report-card") {
      const body = await readJsonBody(req);

      const reportId = body.reportId;
      const report = body.report;

      if (!reportId || !report) {
        return json(res, 400, {
          ok: false,
          error: "Faltan reportId o report",
        });
      }

      const savedReport = await saveReportCard(reportId, report);

      return json(res, 200, {
        ok: true,
        reportId,
        report: savedReport,
        storage: pool ? "postgres" : "memory",
      });
    }

    /* =========================
       MOODLE ENDPOINTS
       ========================= */

    if (url.pathname.startsWith("/moodle/")) {
      if (EVAL_API_KEY) {
        const apiKey = req.headers["x-api-key"];
        if (apiKey !== EVAL_API_KEY) {
          return json(res, 401, {
            ok: false,
            error: "Unauthorized (x-api-key)",
          });
        }
      }

      if (req.method === "GET" && url.pathname === "/moodle/health") {
        return json(res, 200, {
          ok: true,
          service: "moodle-bridge",
          database: pool ? "postgres" : "memory",
        });
      }

      if (req.method === "GET" && url.pathname === "/moodle/assign-id") {
        const courseId = url.searchParams.get("courseId");
        const name = url.searchParams.get("name");

        if (!courseId || !name) {
          return json(res, 400, {
            ok: false,
            error: "Faltan courseId o name",
          });
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
            available: assigns.map((a) => ({
              id: a.id,
              name: a.name,
            })),
          });
        }

        return json(res, 200, {
          ok: true,
          assignId: found.id,
          name: found.name,
        });
      }

      if (req.method === "POST" && url.pathname === "/moodle/grade") {
        const body = await readJsonBody(req);

        const assignId = body.assignId;
        const parentEmail = body.parentEmail;
        const grade = body.grade;
        const feedback = body.feedback || "";

        if (!assignId || !parentEmail || grade == null) {
          return json(res, 400, {
            ok: false,
            error: "Faltan assignId, parentEmail o grade",
          });
        }

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

        const result = await moodleCall("mod_assign_save_grade", {
  assignmentid: assignId,
  userid: userId,
  grade: grade,
  attemptnumber: -1,
  addattempt: 0,
  workflowstate: "graded",
  applytoall: 0,
  sendstudentnotifications: 0,
  "plugindata[assignfeedbackcomments_editor][text]": feedback,
  "plugindata[assignfeedbackcomments_editor][format]": 0,
});

        return json(res, 200, {
          ok: true,
          result,
          assignId,
          userId,
        });
      }

      return json(res, 404, {
        ok: false,
        error: "Not found",
      });
    }

    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      ...corsHeaders(),
    });
    res.end("OK");
  } catch (e) {
    console.error("HTTP ERROR:", e);
    return json(res, 500, {
      ok: false,
      error: e.message,
    });
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
  if (topic === "Práctica de vocabulario de My Book") {
    return ["Yellow", "Red", "Blue", "Green"];
  }
  return ["Good morning"];
}

function buildPrompt(topic, items) {
  const safeItems =
    Array.isArray(items) && items.length > 0
      ? items
      : fallbackItemsForTopic(topic);

  const contentList = safeItems.map((item) => `- ${item}`).join("\n");

  const PRON_LIBRARY = `
BIBLIOTECA PERMANENTE DE PRONUNCIACIÓN (SIEMPRE ACTIVA)
- Feedback breve, pedagógico y útil.
- Si dudas, trátalo como incorrecto y repite el mismo ítem.
- En cada corrección: 1 frase + 1 pista concreta (máx. 2 frases en total).

1) TH tiene 2 pronunciaciones

a) TH suave /θ/ (sin voz)
- Lengua entre los dientes y aire sale sin voz.
Ejemplos: think, thank, three, mouth (sustantivo)
Pista: "Lengua entre dientes y solo aire: thhhh."

b) TH con voz /ð/ (con vibración)
- Misma posición, pero vibran cuerdas vocales.
Ejemplos: this, that, they, mother, brother
Pista: "Misma posición, pero con voz: thhhh (vibra)."

Regla práctica:
- Palabras gramaticales frecuentes suelen usar /ð/: the, this, that, these, those, they, them, then
- Palabras de contenido suelen usar /θ/: think, thank, bath, tooth

2) La H sí se pronuncia (aspirada)
Ejemplos: house, hello, hotel
Pista: "Saca aire suave: hhh."

3) La R inglesa NO es como la R del español
- No vibra, no golpea el paladar.
Ejemplos: red, right, car, teacher
Pista: "R suave hacia atrás, sin vibrar."

4) V y B no son iguales
- V: labio inferior toca dientes superiores (very, van, love)
- B: se juntan los dos labios (boy, big, cab)
Pista: "V con dientes y labio; B con dos labios."
Ejemplo clave: berry ≠ very

REGLAS CLAVE EXTRA (SIEMPRE)
S INICIAL (muy importante)
- Si una palabra empieza con S, NO se pronuncia "es".
  Ej: school ≠ "eschool", square ≠ "esquare", stop ≠ "estop".
Pista corta:
- "Sin 'e' al inicio. Empieza directo con S."

R INGLESA (refuerzo)
- NO vibra (no RRR), NO golpea el paladar.
- La lengua va hacia atrás, sin tocar fuerte.
Ej: red, right, car, teacher.
Pista corta:
- "R suave hacia atrás, sin vibrar."

Y al inicio (ej: Yellow)
- La Y inicial suele sonar como una “i” suave /y/ (no “ye” español marcado).
Ej: yellow.
Pista corta:
- "La Y suena como 'i' suave: y-ellow."

G (verificar pronunciación)
- No cambiarla por J ni suavizarla de más.
- En palabras como “green”, “garage”, “go”, la G debe sonar clara.
Pista corta:
- "Cuida la G: no la cambies, suena clara."

5) La -S final suena diferente
- /s/ después de sonidos sordos: cats, books, maps
- /z/ después de sonidos sonoros: dogs, pens, plays
- /ɪz/ o /əz/ después de s, z, sh, ch, j: buses, washes, changes
Pista: "La S final puede sonar s, z o iz."

6) La terminación -ED tiene 3 sonidos
- /t/: worked, helped, washed
- /d/: played, cleaned, lived
- /ɪd/: wanted, needed (solo si termina en t o d)
Pista: "ED puede sonar t, d o id."

7) No todas las vocales se leen como en español
Ejemplos:
- ship /ɪ/ ≠ sheep /iː/
- full /ʊ/ ≠ fool /uː/
- cat /æ/
- cup /ʌ/
- car /ɑː/ o /ɑr/ según acento
Pista: "No leas vocales como español: cambian mucho."

8) Vocal reducida en sílabas débiles: schwa /ə/
Ejemplos: about, teacher, problem, banana
Pista: "En sílaba débil, vocal neutra rápida: /ə/."

9) El acento de palabra importa
Ejemplos:
- TAble
- imPORtant
- beGIN
- aBOUT
Pista: "Marca la sílaba fuerte (stress)."

10) Las consonantes finales sí se pronuncian
Ejemplos: cat, big, help, left, work
Pista: "Cierra bien el final."

11) L clara vs L oscura
- light (L inicial clara)
- full, school, milk (L final más oscura)
Pista: "L final más pesada/oscura."

12) Letras mudas (a veces no se pronuncian)
know (k muda), write (w muda), climb (b muda), listen (t a veces muda)
Pista: "Ojo letras mudas."

13) -tion suele sonar “shon” /ʃən/
information, nation, station
Pista: "Tion suena shon."

14) CH no siempre suena igual
- /tʃ/: chair, teacher, chocolate
- /ʃ/: machine
- /k/: chorus (a veces)
Pista: "CH puede sonar ch, sh o k según palabra."

15) Entonación importa (no plano)
Really? Are you ready? I don’t know.
Pista: "Sube y baja, no plano."

LAS 5 REGLAS MÁS IMPORTANTES (en práctica diaria)
- TH: /θ/ y /ð/
- V vs B
- R inglesa
- S inicial (sin "es")
- -s final: /s/, /z/, /ɪz/
- -ed final: /t/, /d/, /ɪd/

Mini ejemplos para practicar (si aparece en lista):
think / this
thank / that
berry / very
right / light
school / stop / square
cats / dogs / buses
worked / played / wanted
yellow / yes
green / go / garage
`;

  return `
Eres la Coach oficial de My Team Bilingual Process.

OBJETIVO:
Entrenar pronunciación en inglés.

REGLAS GENERALES:
- Hablas SIEMPRE en español.
- SOLO usas inglés para modelar la palabra o frase objetivo.
- Trabajas UN ítem por vez.
- No cambias de tema.
- No agregas palabras o frases fuera de la lista.
- Si el estudiante pregunta otra cosa, responde: "En este training practicamos solo estas palabras" y vuelve al ítem actual.

TONO (OBLIGATORIO):
- Eres animada, empática y pedagógica.
- Corriges con cariño pero con firmeza.
- Celebras logros sin exagerar.
- Das pistas concretas, cortas y útiles.

MODO DE ENTRENAMIENTO (SIEMPRE):
- Antes de cada ítem dices EXACTAMENTE: "repeat after me".
- Luego pronuncias la palabra o frase en inglés.
- Luego te callas y esperas al estudiante.
- Das feedback breve en español (máximo 2 frases: corrección + pista).
- Nunca avances automáticamente si no está claramente correcto.
- Si dudas, es incorrecto y repites el mismo ítem.

RESPUESTAS (variadas, no repetitivas):
- Si está MAL o si dudas: usa 1 frase corta + 1 pista corta, y repite el mismo ítem.
  Ejemplos de corrección (elige 1):
  - "Casi, pero no."
  - "Todavía no."
  - "No está correcto."
  - "Vamos de nuevo."
  Luego 1 pista de la biblioteca y repites el ítem.

- Si está BIEN: 1 frase y avanzas.
  Ejemplos (elige 1):
  - "Muy bien."
  - "Perfecto."
  - "Excelente."
  - "Bien, sigamos."

${PRON_LIBRARY}

TEMA ACTUAL:
${topic}

LISTA OFICIAL DE ESTA SESIÓN:
${contentList}

CIERRE (OBLIGATORIO):
REGLA ESPECIAL:
- La frase "Well done and see you in the next training" es SOLO despedida.
- NUNCA pidas al estudiante que la repita.
- NUNCA la uses como ítem de práctica.

Cuando termines TODA la lista, debes cerrar SIEMPRE diciendo esta frase exacta al final:
"Well done and see you in the next training"
Esa debe ser tu última frase. Después no sigues hablando.
`;
}

/**
 * MAPA DE SCOPES POR PIN
 * Hoy piloto: PIN_DOCENTE => CO / J1
 */
function scopeForPin(pin) {
  if (pin === String(process.env.PIN_DOCENTE || "")) {
    return {
      countryId: "CO",
      gardenId: "J1",
      allowedGrades: ["GRUPO_A", "GRUPO_B", "GRUPO_C", "GRUPO_D", "GRUPO_E"],
    };
  }

  return null;
}

/* =========================
   START SERVER
   ========================= */

await initReportCardsTable();

server.listen(PORT, () => {
  console.log(`backend ready on port ${PORT}`);
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
        if (ws.readyState === ws.OPEN) {
          ws.close(1000, "training completed");
        }
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
          systemInstruction: {
            parts: [{ text: buildPrompt(topic, items) }],
          },
        },
        callbacks: {
          onmessage: (msg) => {
            try {
              if (msg.setupComplete) {
                ready = true;

                if (ws.readyState === ws.OPEN) {
                  ws.send(JSON.stringify({ type: "readyForUser" }));
                }

                sendInitialInstructionIfReady();
                return;
              }

              const transcriptChunk = msg.outputTranscription?.text;

              if (typeof transcriptChunk === "string" && transcriptChunk.trim()) {
                transcriptBuffer += " " + transcriptChunk.trim();

                if (detectFinalClosing(transcriptBuffer)) {
                  pendingCloseAfterTurn = true;
                }
              }

              const parts = msg.serverContent?.modelTurn?.parts;

              if (parts?.length) {
                for (const p of parts) {
                  if (p.inlineData?.data && ws.readyState === ws.OPEN) {
                    ws.send(
                      JSON.stringify({
                        type: "audio",
                        audio: p.inlineData.data,
                      })
                    );
                  }
                }
              }

              if (msg.serverContent?.turnComplete) {
                if (pendingCloseAfterTurn) {
                  triggerSessionEnd();
                  return;
                }

                transcriptBuffer = "";

                if (ws.readyState === ws.OPEN) {
                  ws.send(JSON.stringify({ type: "turnComplete" }));
                }
              }
            } catch (err) {
              console.error("❌ ERROR MENSAJE:", err);
            }
          },

          onclose: () => {
            googleClosed = true;

            if (pendingCloseAfterTurn && !closeTriggered) {
              triggerSessionEnd();
            }

            if (ws.readyState === ws.OPEN) {
              ws.close();
            }
          },

          onerror: (err) => {
            console.error("🔴 ERROR GEMINI:", err);

            if (ws.readyState === ws.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "error gemini",
                })
              );
            }
          },
        },
      })
      .then((s) => {
        session = s;
        sendInitialInstructionIfReady();

        keepAliveInterval = setInterval(() => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, 15000);
      })
      .catch((err) => {
        console.error("❌ ERROR INICIANDO:", err);

        if (ws.readyState === ws.OPEN) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "no se pudo iniciar gemini",
            })
          );
        }
      });
  }

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "checkTeacherPin") {
        const pin = String(msg.pin || "");
        const scope = scopeForPin(pin);
        const ok = !!scope;

        if (ws.readyState === ws.OPEN) {
          ws.send(
            JSON.stringify({
              type: "pinResult",
              ok,
              scope,
            })
          );
        }

        return;
      }

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
          audio: {
            data: msg.audio,
            mimeType: "audio/pcm;rate=16000",
          },
        });
      }
    } catch (err) {
      console.error("❌ ERROR CLIENT MESSAGE:", err);
    }
  });

  ws.on("close", () => {
    console.log("🔴 CLIENT CLOSED");

    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
    }

    if (session && !googleClosed) {
      try {
        session.close();
      } catch {}
    }

    session = null;
    ready = false;
  });
});
