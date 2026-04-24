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
- Usas lenguaje simple, tipo jardín, y motivas a intentar otra vez.

RESPUESTAS OBLIGATORIAS (VARIAS OPCIONES, PERO REGLAS FIJAS):
- Cuando está MAL o si tienes dudas:
  1) Elige UNA sola frase de corrección (no más de 1 frase) de esta lista:
     - "No está correcto pero podemos mejorar."
     - "Casi, pero no. Sin embargo, podemos mejorar."
     - "Todavía no, pero podemos mejorar."
     - "No, escucha otra vez. Seguro que podemos mejorar la pronunciación."
     - "Te faltó ajustar un sonido."
  2) Agrega UNA pista muy corta en español (máximo 1 frase).
  3) Vuelve a modelar la MISMA palabra (en inglés) y luego silencio.

- Cuando está BIEN:
  1) Elige UNA sola frase de aprobación (solo 1 frase) de esta lista:
     - "Bien. Siguiente."
     - "Perfecto. Siguiente."
     - "Muy bien. Continuemos."
     - "Excelente. Seguimos."
  2) Avanza al siguiente ítem inmediatamente.

REGLA ANTI-VERBORREA:
- Nunca digas más de 2 frases seguidas (corrección + pista).
- No hagas explicaciones largas.
- No converses: entrenas pronunciación.

MODO DE ENTRENAMIENTO (siempre):
- Antes de cada ítem dices exactamente: "repeat after me".
- Luego pronuncias la palabra o frase en inglés.
- Luego te callas y esperas al estudiante.
- Das feedback breve en español (1 frase).
- Nunca avances automáticamente.

CRITERIOS DE PRONUNCIACIÓN (para decidir correcto/incorrecto):
- Presta especial atención a la primera y la última sílaba.
- Si dudas, se considera incorrecto y se repite.
- Si hay errores fonéticos evidentes, se considera incorrecto y se repite.
- Cuando haya palabras con "R" en inglés: NO aceptar si el usuario golpea el paladar. La "R" en inglés es suave.
- Cuando haya palabras con "S" al inicio: NO se pronuncia "es".
- SONIDO TH (cuando corresponda):
  - Lengua un poquito afuera entre los dientes y sopla suave: "thhhh".
  - No es T ni D.
- Si detectas cualquiera de estos errores, es incorrecto y se repite.

PROTECCIÓN FRASE FINAL (OBLIGATORIA):
- La frase "Well done and see you in the next training" NO es un ítem de práctica.
- NUNCA pidas al estudiante que la repita.
- Si el estudiante la dice, responde: "Esa frase es de despedida. Seguimos con la palabra." y vuelve al ítem actual.

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

server.listen(PORT, () => {
  console.log("backend ready");
});

wss.on("connection", (ws) => {
  console.log("🟢 CLIENTE CONECTADO");

  // === VOZ / SESIÓN ===
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

  // === CIERRE ===
  function triggerSessionEnd() {
    if (closeTriggered) return;
    closeTriggered = true;
    pendingCloseAfterTurn = false;

    console.log("🏁 CERRANDO SESIÓN");

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

    console.log("💬 COACH INICIADA");
  }

  function startGeminiSession() {
    console.log("🎯 INICIANDO SESIÓN CON TEMA:", topic);
    console.log("📚 ITEMS:", items);

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
              prebuiltVoiceConfig: {
                voiceName: "Kore",
              },
            },
          },
          systemInstruction: {
            parts: [{ text: buildPrompt(topic, items) }],
          },
        },
        callbacks: {
          onopen: () => {
            console.log("🟣 GOOGLE LIVE ABIERTA");
          },

          onmessage: (msg) => {
            try {
              if (msg.setupComplete) {
                ready = true;
                console.log("✅ SETUP COMPLETO");

                if (ws.readyState === ws.OPEN) {
                  ws.send(JSON.stringify({ type: "readyForUser" }));
                }

                sendInitialInstructionIfReady();
                return;
              }

              const transcriptChunk = msg.outputTranscription?.text;

              if (typeof transcriptChunk === "string" && transcriptChunk.trim()) {
                const cleanChunk = transcriptChunk.trim();
                transcriptBuffer += " " + cleanChunk;

                // console.log("📝 TRANSCRIPCIÓN:", cleanChunk);

                if (detectFinalClosing(transcriptBuffer)) {
                  pendingCloseAfterTurn = true;
                  console.log("🏁 FRASE FINAL DETECTADA");
                }
              }

              const parts = msg.serverContent?.modelTurn?.parts;
              if (parts?.length) {
                for (const p of parts) {
                  if (p.inlineData?.data) {
                    process.stdout.write("🔊");
                    if (ws.readyState === ws.OPEN) {
                      ws.send(
                        JSON.stringify({
                          type: "audio",
                          audio: p.inlineData.data,
                        })
                      );
                    }
                  }
                }
              }

              if (msg.serverContent?.turnComplete) {
                console.log("\n✅ TURNO COMPLETO");
                console.log("📌 pendingCloseAfterTurn:", pendingCloseAfterTurn);

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

          onclose: (e) => {
            googleClosed = true;
            console.log(`⚪ GOOGLE CERRÓ: ${e.code}`);

            if (pendingCloseAfterTurn && !closeTriggered) {
              triggerSessionEnd();
              return;
            }

            if (ws.readyState === ws.OPEN) {
              ws.close();
            }
          },

          onerror: (err) => {
            console.error("🔴 ERROR GEMINI:", err);

            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: "error", message: "error gemini" }));
            }
          },
        },
      })
      .then((s) => {
        session = s;
        console.log("🔗 SESIÓN LISTA");

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
          ws.send(JSON.stringify({ type: "error", message: "no se pudo iniciar gemini" }));
        }
      });
  }

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      /* =========================
         ✅ PIN ÚNICO DOCENTE
      ========================= */
      if (msg.type === "checkTeacherPin") {
        const pin = String(msg.pin || "");
        const expected = String(process.env.PIN_DOCENTE || "");
        const ok = expected.length > 0 && pin === expected;

        console.log("🔐 checkTeacherPin", { ok });

        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "pinResult", ok }));
        }
        return;
      }

      /* =========================
         Sesión normal (voz)
      ========================= */
      if (msg.type === "startSession") {
        topic = msg.topic || "Frases de la semana";
        items =
          Array.isArray(msg.items) && msg.items.length > 0
            ? msg.items
            : fallbackItemsForTopic(topic);

        console.log("📚 TEMA RECIBIDO:", topic);
        console.log("🧾 ITEMS RECIBIDOS:", items);

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
      keepAliveInterval = null;
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
