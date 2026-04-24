import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality } from "@google/genai";

const PORT = process.env.PORT || 8080;

const server = http.createServer();
const wss = new WebSocketServer({ server });

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { apiVersion: "v1beta" },
});

function fallbackItemsForTopic(topic) {
  if (topic === "Frases de la semana") return ["Good morning"];
  if (topic === "Práctica de vocabulario de My Book") return ["Yellow", "Red", "Blue", "Green"];
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
 * Hoy piloto: 304726 => CO / J1 (Miska Muska)
 * Mañana: agregás más pins aquí y listo (LATAM escalable).
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
                if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "readyForUser" }));
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
                if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "turnComplete" }));
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
            if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "error", message: "error gemini" }));
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
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "error", message: "no se pudo iniciar gemini" }));
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
        items = Array.isArray(msg.items) && msg.items.length > 0 ? msg.items : fallbackItemsForTopic(topic);
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
