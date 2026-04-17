import http from "http";
import { WebSocketServer, WebSocket } from "ws";
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

- Good morning
- say good bye
- Take the pencil
- take your implements
- go to the bathroom
- go to your bedroom
- Brush your teeth
- wash your hands
- Clean your table
- clean your room

Debes modelar la pronunciación de cada frase.
Debes pedir repetición usando siempre: "repeat after me"
Debes corregir con entusiasmo y cariño.
`;
  }

  if (topic === "Práctica de vocabulario del libro") {
    topicInstructions = `
TEMA DE ESTA SESIÓN:
Debes guiar al estudiante en práctica de vocabulario del libro interactivo.

Debes:
- modelar palabras y frases clave en inglés
- pedir repetición usando siempre: "repeat after me"
- corregir con entusiasmo
- mantenerte enfocada en vocabulario y pronunciación
`;
  }

  return `
Eres Kore, una Coach experta de "My Team". Tu objetivo es entrenar al usuario en la pronunciación de inglés.

REGLAS GENERALES:
- Habla SIEMPRE en ESPAÑOL.
- Usa género femenino para referirte a ti misma.
- Solo usa el INGLÉS para modelar las palabras o frases que el usuario debe repetir.
- Antes de pedirle al usuario que repita una palabra o frase, di siempre: "repeat after me".
- Sé extremadamente positiva, energética y motivadora.
- No ofrezcas opciones.
- No cambies de tema.
- Mantén la sesión enfocada solo en el tema asignado.

FLUJO DE INICIO:
- Saluda con entusiasmo y dale la bienvenida a My Team.
- Preséntate diciendo: "Hola, soy tu coach de My Team Proceso de Bilinguismo."
- Pregunta el nombre del estudiante.
- Una vez sepas su nombre, detecta si es hombre o mujer y dile "Bienvenido" o "Bienvenida" según corresponda.
- Inmediatamente después, comienza con el entrenamiento del tema asignado.

${topicInstructions}

CIERRE:
- Cuando el usuario haya completado con éxito el tema asignado, felicítalo con mucho cariño por su gran progreso en su Bilingual Process.
- Al final de tu despedida, debes decir obligatoriamente en inglés:
"well done! and See you in the next training"
`;
}

server.listen(PORT, () => {
  console.log(`🚀 BACKEND READY - KORE PRO en puerto ${PORT}`);
});

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENTE CONECTADO");

  const ref = {
    session: null,
    ready: false,
    clientClosed: false,
    googleClosed: false,
    topic: "Frases de la semana",
    studentName: "",
  };

  let keepAliveInterval = null;

  try {
    const session = await ai.live.connect({
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
              text: buildSystemInstruction(ref.topic),
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
              console.log("✅ SETUP COMPLETO - DESPERTANDO A KORE");
              ref.ready = true;

              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "readyForUser" }));
              }

              try {
                session.sendRealtimeInput({
                  text: `Inicia la sesión ahora. Preséntate como coach de My Team, pregunta el nombre del estudiante y comienza inmediatamente con el tema: ${ref.topic}.`,
                });
                console.log("💬 SALUDO ENVIADO");
              } catch (e) {
                console.error("❌ Error al despertar:", e?.message || e);
              }

              return;
            }

            const parts = msg.serverContent?.modelTurn?.parts;
            if (parts?.length) {
              for (const p of parts) {
                if (p.inlineData?.data) {
                  process.stdout.write("🔊");

                  if (ws.readyState === WebSocket.OPEN) {
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

              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "turnComplete" }));
              }
            }
          } catch (err) {
            console.error("❌ Error en onmessage Gemini:", err?.message || err);
          }
        },

        onclose: (e) => {
          ref.googleClosed = true;
          console.log(
            `⚪ GOOGLE CERRÓ CONEXIÓN: código ${e.code}, razón: ${e.reason}`
          );

          if (!ref.clientClosed && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: `Gemini cerró la sesión (${e.code})`,
              })
            );
            ws.close();
          }
        },

        onerror: (e) => {
          console.error("🔴 ERROR GEMINI:", e);

          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Error en sesión Gemini",
              })
            );
          }
        },
      },
    });

    ref.session = session;
    console.log("🔗 SESIÓN GEMINI ESTABLECIDA");

    keepAliveInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "ping" }));
        } catch {}
      }
    }, 15000);

    ws.on("message", (data) => {
      try {
        const raw = data.toString();
        console.log("📥 MENSAJE DESDE FRONTEND:", raw.slice(0, 120));

        const msg = JSON.parse(raw);

        if (msg.type === "startSession") {
          ref.topic = msg.topic || "Frases de la semana";
          console.log("📚 TEMA SELECCIONADO:", ref.topic);
          return;
        }

        if (msg.type === "audio") {
          console.log("🎤 AUDIO RECIBIDO DEL NAVEGADOR:", msg.audio?.length || 0);
        }

        if (msg.type === "audio" && ref.session && ref.ready) {
          ref.session.sendRealtimeInput({
            audio: {
              data: msg.audio,
              mimeType: "audio/pcm;rate=16000",
            },
          });
        }
      } catch (e) {
        console.error(
          "❌ Error procesando mensaje del cliente:",
          e?.message || e
        );
      }
    });

    ws.on("close", () => {
      ref.clientClosed = true;
      console.log("🔴 CLIENTE DESCONECTADO");

      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
      }

      if (ref.session && !ref.googleClosed) {
        try {
          ref.session.close();
        } catch (e) {
          console.error("❌ Error cerrando sesión Gemini:", e?.message || e);
        }
      }
    });

    ws.on("error", (err) => {
      console.error("❌ ERROR WS CLIENTE:", err?.message || err);
    });
  } catch (err) {
    console.error(
      "❌ ERROR CRÍTICO AL CONECTAR CON GEMINI:",
      err?.message || err
    );

    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
    }

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: err?.message || "No se pudo conectar con Gemini",
        })
      );
      ws.close();
    }
  }
});
