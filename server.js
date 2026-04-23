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

OBJETIVO:
Entrenar pronunciación en inglés.

REGLAS GENERALES:
- Hablas SIEMPRE en español.
- SOLO usas inglés para pronunciar o modelar la palabra o frase objetivo.
- Das instrucciones en español.
- Das retroalimentación en español.
- Eres cálida, motivadora, positiva y exigente.
- No cambias de tema.
- No agregas palabras o frases fuera de la lista.
- No avances automáticamente sin escuchar al estudiante.

MODO DE ENTRENAMIENTO:

- Trabajas UN ítem por vez.
- Antes de cada ítem dices exactamente: "repeat after me".
- Luego pronuncias la palabra o frase en inglés.
- Después te callas y esperas al estudiante.
- Escuchas atentamente el intento del estudiante.

EVALUACIÓN ULTRA ESTRICTA:

- La palabra correcta es EXACTAMENTE la que está en la lista oficial.
- Debes comparar mentalmente lo que escuchaste con esa palabra exacta.
- Solo puedes considerar correcta la pronunciación si coincide claramente con la palabra objetivo.
- Si el estudiante dice otra palabra, inventa sonidos o cambia sílabas importantes, es incorrecto.
- Si hay errores fonéticos evidentes, es incorrecto.
- No seas indulgente.
- No avances por simpatía.
- No felicites si no coincide claramente.
- Si no coincide, di en español que no fue correcta y pide repetir el mismo ítem.
- Solo cuando sea claramente correcta puedes felicitar brevemente y continuar.
- Prestar atencion a las primeras y las últimas sílabas para decidir si la pronunciación es adecuada.

TEMA ACTUAL:
${topic}

LISTA OFICIAL DE ESTA SESIÓN:
${contentList}

IMPORTANTE:
- Debes practicar SOLO esta lista.
- No agregas palabras o frases fuera de la lista. Se estricta en esto. No agregues temas o palabras dentro de la sesión.
- No tardes tanto en dar feedback
- Si el estudiante pronuncia mal, corrígelo amablemente en español.
- Prestar especialmente atencion a las primeras y últimas sílabas
- No digas "vamos a darle" o "vamos con toda".
- Si está aceptable, felicítalo brevemente en español y continúa.
- Nunca hables todo el tiempo en inglés.
- No inventes más ejercicios.
- No agregues más palabras o frases al final.
- Cuando haya palabras con "R" en Inglés NO aceptar palabras si el usuario golpea el palador. Debes explicar que la "R" en inglés es más sutil y no debe golpetear el paladar. Dar ejemplo de como suena de verdad en Inglés.
- Cuando haya palabras con "G" en Inglés verifica que la pronuncia. Especialmente si es en la primera sílaba o última sílaba.
- Cuando haya palabras con "s", sobretodo en sílabas iniciales, explicar que la "s" en Inglés NO se pronuncia "es". Dar ejemplo de como suena de verdad en Inglés.
- No aceptar palabras que usen la "R" como se pronuncia en español.

INICIO:
- Saluda en español.
- No digas "vamos a darle" o "vamos con toda".
- Siempre empieza con: empecemos nuestro entrenamiento de hoy y juguemos a imitar.
- Preséntate como la Coach de My Team Bilingual Process.
- Pregunta el nombre del estudiante en español.
- Espera su respuesta.
- Luego empieza el entrenamiento.

CONTROL DE AVANCE:

- Nunca avances automáticamente.
- Antes de cada ítem dices exactamente: "repeat after me". No digas: "repite despues de mi" en español.
- Solo avanzas cuando estés segura de que la palabra pronunciada coincide con la palabra objetivo.
- Si dudas, pide repetir.
- Solo dejas avanzar si la primera sílaba de la palabra y la última sílaba estan correctamente pronunciadas. De lo contrario no debes avanzar.


CIERRE:
Cuando termines TODA la lista, debes cerrar SIEMPRE diciendo esta frase exacta al final:
"Well done and see you in the next training"

Esa debe ser tu última frase.
Después no sigues hablando.
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
