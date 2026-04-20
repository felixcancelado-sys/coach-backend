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
  if (topic === "Frases de la semana") {
    return ["Good morning"];
  }

  if (topic === "Práctica de vocabulario de My Book") {
    return ["Circle", "Square", "Triangle", "Rectangle"];
  }

  return ["Good morning"];
}

function buildPrompt(topic, items) {
  const safeItems =
    Array.isArray(items) && items.length > 0
      ? items
      : fallbackItemsForTopic(topic);

  const contentList = safeItems.map((item) => `- ${item}`).join("\n");

  return `
Eres la Coach oficial de My Team Bilingual Process.

IDENTIDAD:
- Hablas siempre en español.
- Solo usas inglés para pronunciar la palabra objetivo.
- Eres cálida, motivadora y clara.
- No cambias de tema.
- No inventas ejercicios.
- No agregas palabras fuera de la lista oficial.

REGLA FUNDAMENTAL:
- NO avanzas automáticamente.
- No decides cuándo cambiar de palabra por tu cuenta.
- Esperas instrucciones del sistema antes de dar feedback o avanzar.

FUNCIONAMIENTO:
- Cuando el sistema lo indique, dices exactamente: "repeat after me".
- Luego modelas la palabra en inglés.
- Después guardas silencio y esperas al estudiante.
- Cuando el sistema lo indique, das feedback en español.
- Cuando el sistema lo indique, avanzas al siguiente ítem.
- Si el sistema no indica nada, permaneces en silencio.

TEMA ACTUAL:
${topic}

LISTA OFICIAL:
${contentList}

CIERRE:
Solo cuando el sistema lo indique, debes decir exactamente:
"Well done and see you in the next training"

Después de esa frase, no sigues hablando.
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

  let session = null;
  let ready = false;
  let topic = "Frases de la semana";
  let items = fallbackItemsForTopic(topic);
  let currentIndex = 0; // 🔥 control real de ítem actual
  let greetingFinished = false; // 🔥 nuevo

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

    console.log("🏁 CERRANDO SESIÓN");

    if (ws.readyState === ws.OPEN) {
      ws.send(
        JSON.stringify({
          type: "sessionEnded",
        })
      );
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
      "Saluda en español, preséntate como la Coach de My Team y pregunta el nombre del estudiante. Luego espera instrucciones del sistema.",
  });

  console.log("💬 COACH INICIADA");
}
  function sendNextWord() {
  if (!session) return;

  const nextWord = items[currentIndex];
  if (!nextWord) return;

  session.sendRealtimeInput({
    text: `Di exactamente: "repeat after me", luego pronuncia claramente la palabra ${nextWord} y después guarda silencio.`,
  });
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
            parts: [
              {
                text: buildPrompt(topic, items),
              },
            ],
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

                console.log("📝 TRANSCRIPCIÓN:", cleanChunk);

                // 🔥 VALIDACIÓN REAL DE PRONUNCIACIÓN
const studentSaid = normalizeText(cleanChunk);
const expected = normalizeText(items[currentIndex] || "");

console.log("👂 ESTUDIANTE:", studentSaid);
console.log("🎯 ESPERADO:", expected);

if (expected && !studentSaid.includes(expected)) {
  console.log("❌ PRONUNCIACIÓN INCORRECTA - BLOQUEANDO AVANCE");

  session.sendRealtimeInput({
    text:
      "La pronunciación no fue correcta. Debes pedir repetir exactamente la misma palabra antes de continuar.",
  });

  return; // 🔒 Bloquea el avance al siguiente ítem
}

if (expected && studentSaid.includes(expected)) {
  console.log("✅ PRONUNCIACIÓN ACEPTADA");
  currentIndex++;
}

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

  // 🔥 Solo después del saludo enviamos la primera palabra
  if (!greetingFinished) {
    greetingFinished = true;
    sendNextWord();
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

     if (msg.type === "startSession") {
  topic = msg.topic || "Frases de la semana";

  items =
    Array.isArray(msg.items) && msg.items.length > 0
      ? msg.items
      : fallbackItemsForTopic(topic);

  currentIndex = 0; // 🔥 RESET DEL ÍTEM ACTUAL

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
