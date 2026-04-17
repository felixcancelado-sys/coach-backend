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
Debes trabajar únicamente estas frases, una por una:

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

Antes de cada frase debes decir:
repeat after me

Corrige con entusiasmo y cariño.
`;
  }

  if (topic === "Práctica de vocabulario del libro") {
    topicInstructions = `
TEMA DE ESTA SESIÓN:
Debes trabajar únicamente estas palabras, una por una:

Circle
Triangle
Square
Rectangle

Antes de cada palabra debes decir:
repeat after me

Corrige con entusiasmo.
`;
  }

  return `
Eres una Coach experta de My Team Bilingual Process.

OBJETIVO:
Entrenar pronunciación en inglés.

REGLAS:
Hablas SIEMPRE en español.
Usas inglés solo para modelar pronunciación.
Eres positiva, energética y motivadora.
No ofreces opciones.
No cambias de tema.

FLUJO:
1. Saluda con entusiasmo.
2. Preséntate como coach My Team.
3. Pregunta el nombre del estudiante.
4. Usa Bienvenido o Bienvenida según corresponda.
5. Comienza inmediatamente el entrenamiento.

${topicInstructions}

CIERRE:
Cuando el entrenamiento termine:
- despídete con cariño
- di explícitamente: "Hemos terminado la sesión."
- luego di exactamente en inglés:
"well done! and See you in the next training"
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

  function startGeminiSession() {
    console.log("🎯 INICIANDO SESIÓN CON TEMA:", topic);

    ai.live
      .connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
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
                    "Preséntate como coach de My Team Bilingual process, pregunta el nombre del estudiante, ESPERA A QUE TE RESPONDA SU NOMBRE y después, comienza el entrenamiento.",
                });

                console.log("💬 COACH INICIADA");
                return;
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

                if (ws.readyState === ws.OPEN) {
                  ws.send(
                    JSON.stringify({
                      type: "turnComplete",
                    })
                  );
                }
              }
            } catch (err) {
              console.error("❌ ERROR MENSAJE GEMINI:", err);
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
        console.error("❌ ERROR INICIANDO GEMINI:", err);

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
        topic = msg.topic;
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

        return;
      }
    } catch (err) {
      console.error("❌ ERROR CLIENT MESSAGE:", err);
    }
  });

  ws.on("close", () => {
    console.log("🔴 CLIENTE DESCONECTADO");

    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
    }

    if (session && !googleClosed) {
      try {
        session.close();
      } catch {}
    }
  });
});
