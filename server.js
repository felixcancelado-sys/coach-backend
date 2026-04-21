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
  if (topic === "Práctica de vocabulario de My Book") {
    return ["Yellow", "Red", "Blue", "Green"];
  }
  return ["Good morning"];
}

/**
 * PROMPT CONTROLADO: el modelo obedece órdenes:
 * - MODEL: <word>
 * - CORRECT
 * - INCORRECT
 * - CLOSE
 */
function buildPrompt(topic, items) {
  const safeItems =
    Array.isArray(items) && items.length > 0
      ? items
      : fallbackItemsForTopic(topic);

  const contentList = safeItems.map((i) => `- ${i}`).join("\n");

  return `
Eres la Coach oficial de My Team Bilingual Process.

IDENTIDAD:
- Hablas siempre en español.
- Solo usas inglés para pronunciar la palabra objetivo.
- Eres cálida, clara y profesional.
- No cambias de tema.
- No inventas palabras.
- No agregas ejercicios.

REGLA ABSOLUTA:
- NO decides si la pronunciación es correcta.
- NO avanzas automáticamente.
- Solo actúas cuando el sistema te lo indique.

INSTRUCCIONES DEL SISTEMA (OBEDECE EXACTAMENTE):
- Si recibes "MODEL: <PALABRA>":
  1) dices EXACTAMENTE: repeat after me
  2) pronuncias <PALABRA> en inglés de forma clara
  3) guardas silencio

- Si recibes "CORRECT":
  felicitas brevemente en español (1 frase) y guardas silencio.

- Si recibes "INCORRECT":
  corriges en español (1 frase) y pides repetir la MISMA palabra, y guardas silencio.

- Si recibes "CLOSE":
  dices EXACTAMENTE: Well done and see you in the next training
  y luego no hablas más.

TEMA ACTUAL:
${topic}

LISTA OFICIAL:
${contentList}
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

  let currentIndex = 0; // ✅ control real
  let greetingFinished = false; // ✅ para iniciar MODEL solo 1 vez tras saludo/nombre

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
        "Saluda en español, preséntate como la Coach de My Team y pregunta el nombre del estudiante. Luego guarda silencio.",
    });

    console.log("💬 COACH INICIADA");
  }

  // ✅ El backend ordena el próximo MODEL
  function sendNextWord() {
    if (!session) return;

    if (currentIndex >= items.length) {
      console.log("🏁 LISTA TERMINADA -> CLOSE");
      session.sendRealtimeInput({ text: "CLOSE" });
      pendingCloseAfterTurn = true;
      return;
    }

    const word = items[currentIndex];
    console.log("📤 ENVIANDO MODEL:", word);

    session.sendRealtimeInput({
      text: `MODEL: ${word}`,
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
    greetingFinished = false;

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
              // ✅ Setup
              if (msg.setupComplete) {
                ready = true;
                console.log("✅ SETUP COMPLETO");

                if (ws.readyState === ws.OPEN) {
                  ws.send(JSON.stringify({ type: "readyForUser" }));
                }

                sendInitialInstructionIfReady();
                return;
              }

              // ✅ Acumular transcripción SOLO (sin evaluar aquí)
              const transcriptChunk = msg.outputTranscription?.text;
              if (typeof transcriptChunk === "string" && transcriptChunk.trim()) {
                const cleanChunk = transcriptChunk.trim();
                transcriptBuffer += " " + cleanChunk;

                console.log("📝 TRANSCRIPCIÓN:", cleanChunk);

                if (detectFinalClosing(transcriptBuffer)) {
                  pendingCloseAfterTurn = true;
                  console.log("🏁 FRASE FINAL DETECTADA");
                }
              }

              // ✅ Audio del modelo → frontend
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

              // ✅ Evaluación SOLO al finalizar turno
              if (msg.serverContent?.turnComplete) {
                console.log("\n✅ TURNO COMPLETO");
                console.log("📌 pendingCloseAfterTurn:", pendingCloseAfterTurn);

                if (pendingCloseAfterTurn) {
                  triggerSessionEnd();
                  return;
                }

                // 1) Al terminar el saludo/nombre, arrancamos el primer MODEL una sola vez
                if (!greetingFinished) {
                  greetingFinished = true;
                  transcriptBuffer = "";
                  sendNextWord();

                  if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({ type: "turnComplete" }));
                  }
                  return;
                }

                // 2) Evaluación del intento del estudiante (texto acumulado)
                const spoken = normalizeText(transcriptBuffer);
                const expected = normalizeText(items[currentIndex] || "");

                console.log("🧠 ESPERADO:", expected);
                console.log("🗣️ ESCUCHADO:", spoken);

                if (spoken) {
                  if (expected && spoken.includes(expected)) {
                    console.log("✅ CORRECTO");
                    session.sendRealtimeInput({ text: "CORRECT" });

                    currentIndex++;
                    transcriptBuffer = "";

                    setTimeout(() => {
                      sendNextWord();
                    }, 600);

                    if (ws.readyState === ws.OPEN) {
                      ws.send(JSON.stringify({ type: "turnComplete" }));
                    }
                    return;
                  } else {
                    console.log("❌ INCORRECTO");
                    session.sendRealtimeInput({ text: "INCORRECT" });

                    transcriptBuffer = "";

                    if (ws.readyState === ws.OPEN) {
                      ws.send(JSON.stringify({ type: "turnComplete" }));
                    }
                    return;
                  }
                }

                // 3) Si no hubo transcripción, limpiamos y seguimos
                transcriptBuffer = "";

                if (ws.readyState === ws.OPEN) {
                  ws.send(JSON.stringify({ type: "turnComplete" }));
                }
              }
            } catch (err) {
              console.error("❌ ERROR MENSAJE:", err);
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

          onclose: (e) => {
            googleClosed = true;
            console.log("⚪ GOOGLE CERRÓ:", e?.code);
          },
        },
      })
      .then((s) => {
        session = s;
        console.log("🔗 SESIÓN LISTA");

        // keepAlive ping al front (tu patrón original)
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

        currentIndex = 0;
        greetingFinished = false;
        transcriptBuffer = "";
        pendingCloseAfterTurn = false;

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
