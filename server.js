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

function buildSystemInstruction(topic) {
  let topicInstructions = "";

  if (topic === "Frases de la semana") {
    topicInstructions = `
TEMA DE ESTA SESIÓN:
Debes trabajar únicamente estas frases y ninguna otra:

Good morning
say good bye
Take the pencil
take your implements
go to the bathroom
go to your bedroom
Brush your teeth
wash your hands
Clean up your table
clean up your room
Clean your nose
Comb your hair

REGLAS ESPECÍFICAS:
- Solo puedes trabajar estas frases.
- No puedes agregar palabras nuevas.
- No puedes introducir frases adicionales.
- Antes de cada frase debes decir exactamente: "repeat after me".
- Luego modelas la frase en inglés.
- Después debes callar y esperar a que el estudiante repita.
- No avanzas a la siguiente frase hasta que el estudiante haya intentado pronunciar la actual.
- Después de escuchar al estudiante, das retroalimentación breve, positiva y útil sobre su pronunciación.
- Luego continúas con la siguiente frase.
`;
  }

  if (topic === "Práctica de vocabulario de My Book") {
    topicInstructions = `
TEMA DE ESTA SESIÓN:
Debes trabajar únicamente estas palabras y ninguna otra:

Circle
Square
Triangle
Rectangle

REGLAS ESPECÍFICAS:
- Solo puedes trabajar estas 4 palabras.
- No puedes introducir ninguna palabra diferente.
- No puedes practicar palabras como process, success u otras.
- No puedes agregar vocabulario adicional.
- Antes de cada palabra debes decir exactamente: "repeat after me".
- Luego modelas la palabra en inglés.
- Después debes callar y esperar a que el estudiante repita.
- No avanzas a la siguiente palabra hasta que el estudiante haya intentado pronunciar la actual.
- Después de escuchar al estudiante, das retroalimentación breve, positiva y útil sobre su pronunciación.
- Luego continúas con la siguiente palabra.
`;
  }

  return `
Eres una Coach experta de My Team Bilingual Process.

OBJETIVO:
Entrenar pronunciación en inglés.

REGLAS GENERALES:
- Hablas SIEMPRE en español.
- Usas inglés solo para modelar pronunciación.
- Eres positiva, energética, cálida y motivadora.
- No ofreces opciones.
- No cambias de tema.
- Debes respetar estrictamente el contenido del tema asignado.
- Debes escuchar al estudiante y responder a lo que dijo.
- Debes corregir con amabilidad.
- Debes esperar la respuesta del estudiante antes de seguir.
- Nunca avances automáticamente por toda la lista sin esperar intento del estudiante y sin dar feedback.

FLUJO:
1. Saluda con entusiasmo.
2. Preséntate como coach My Team.
3. Pregunta el nombre del estudiante.
4. Usa Bienvenido o Bienvenida según corresponda.
5. Comienza inmediatamente el entrenamiento del tema asignado.
6. Trabaja un ítem por vez.
7. Escucha al estudiante.
8. Da feedback.
9. Recién después continúa.

${topicInstructions}

CIERRE:
Cuando el entrenamiento termine:
- despídete con cariño
- di explícitamente esta frase exacta en español:
"Hemos terminado la sesión."
- luego di exactamente esta frase en inglés:
"well done! and See you in the next training"
- después de eso no continúes hablando.
`;
}

server.listen(PORT, () => {
  console.log(`🚀 BACKEND PRO READY en puerto ${PORT}`);
});

wss.on("connection", (ws) => {
  console.log("🟢 CLIENTE CONECTADO");

  let session = null;
  let topic = "Frases de la semana";
  let ready = false;
  let googleClosed = false;
  let keepAliveInterval = null;

  let transcriptBuffer = "";
  let pendingCloseAfterTurn = false;
  let closeTriggered = false;

  function normalizeText(text) {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function detectClosing(text) {
    const normalized = normalizeText(text);

    const strongSignals = [
      "hemos terminado la sesion",
      "well done and see you in the next training",
      "well done see you in the next training",
      "see you in the next training",
    ];

    return strongSignals.some((signal) => normalized.includes(signal));
  }

  function triggerSessionEnd() {
    if (closeTriggered) return;
    closeTriggered = true;

    console.log("🏁 CIERRE AUTOMÁTICO DE SESIÓN");

    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "sessionEnded" }));
    }

    setTimeout(() => {
      try {
        if (ws.readyState === ws.OPEN) {
          ws.close(1000, "training completed");
        }
      } catch {}
    }, 700);
  }

  function startGeminiSession() {
    console.log("🎯 INICIANDO SESIÓN CON TEMA:", topic);

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
                text: buildSystemInstruction(topic),
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
                console.log("✅ SETUP COMPLETO");

                ready = true;

                if (ws.readyState === ws.OPEN) {
                  ws.send(JSON.stringify({ type: "readyForUser" }));
                }

                session.sendRealtimeInput({
                  text:
                    "Preséntate como coach de My Team Bilingual Process, pregunta el nombre del estudiante, espera su respuesta, y luego comienza el entrenamiento respetando el tema asignado, un ítem a la vez, con feedback antes de avanzar.",
                });

                console.log("💬 COACH INICIADA");
                return;
              }

              const transcriptChunk = msg.outputTranscription?.text;

              if (typeof transcriptChunk === "string" && transcriptChunk.trim()) {
                const cleanChunk = transcriptChunk.trim();
                transcriptBuffer += " " + cleanChunk;

                const normalizedBuffer = normalizeText(transcriptBuffer);

                console.log("📝 TRANSCRIPCIÓN CHUNK:", cleanChunk);
                console.log("🧠 BUFFER:", normalizedBuffer);

                if (detectClosing(normalizedBuffer)) {
                  pendingCloseAfterTurn = true;
                  console.log("🏁 DESPEDIDA DETECTADA");
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

                if (ws.readyState === ws.OPEN) {
                  ws.send(JSON.stringify({ type: "turnComplete" }));
                }

                if (pendingCloseAfterTurn) {
                  pendingCloseAfterTurn = false;
                  triggerSessionEnd();
                }

                transcriptBuffer = "";
              }
            } catch (err) {
              console.error("❌ ERROR MENSAJE:", err);
            }
          },

          onclose: (e) => {
            googleClosed = true;
            console.log(`⚪ GOOGLE CERRÓ: ${e.code}`);

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

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === "startSession") {
        topic = msg.topic || "Frases de la semana";
        console.log("📚 TEMA RECIBIDO:", topic);
        startGeminiSession();
        return;
      }

      if (msg.type === "audio") {
        if (!session || !ready) return;

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
    console.log("🔴 CLIENTE DESCONECTADO");

    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
    }

    if (session && !googleClosed) {
      try {
        session.close();
      } catch {}
    }
  });
});
