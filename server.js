import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI } from "@google/genai";

const PORT = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocketServer({ server });

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { apiVersion: "v1beta" },
});

server.listen(PORT, () => {
  console.log(`🚀 BACKEND READY - AOEDE V12 en puerto ${PORT}`);
});

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENTE CONECTADO");

  // FIX #1: Usamos un objeto contenedor para que el callback
  // pueda acceder a session aunque todavía no fue asignada
  const ref = { session: null, ready: false };

  try {
    const session = await ai.live.connect({
      // FIX #2: Modelo correcto y disponible
      model: "models/gemini-3.1-flash-live-preview",
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Aoede" },
          },
        },
        systemInstruction: {
          parts: [
            {
              text: `Eres Aoede, una coach de inglés amigable y motivadora. 
              Cuando el usuario te salude, respóndele en español con energía y 
              preséntate brevemente. Luego ayudalo a practicar inglés.`,
            },
          ],
        },
      },
      callbacks: {
        onmessage: async (msg) => {
          // FIX #3: Ahora session ya está asignada antes de que llegue setupComplete
          if (msg.setupComplete) {
            console.log("✅ SETUP COMPLETO - DESPERTANDO A AOEDE");
            ref.ready = true;
            try {
              await ref.session.send({
                clientContent: {
                  turns: [
                    {
                      role: "user",
                      parts: [{ text: "Hola Aoede, preséntate." }],
                    },
                  ],
                  turnComplete: true,
                },
              });
              console.log("💬 SALUDO ENVIADO");
            } catch (e) {
              // FIX #4: Logueamos el error real
              console.error("❌ Error al despertar:", e.message, e);
            }
          }

          // Recibimos audio de Gemini y lo mandamos al frontend
          const parts = msg.serverContent?.modelTurn?.parts;
          if (parts) {
            parts.forEach((p) => {
              if (p.inlineData?.data) {
                process.stdout.write("🔊");
                if (ws.readyState === ws.OPEN) {
                  ws.send(JSON.stringify({ type: "audio", audio: p.inlineData.data }));
                }
              }
            });
          }

          // Avisamos al frontend cuando Gemini terminó de hablar
          if (msg.serverContent?.turnComplete) {
            console.log("\n✅ TURNO COMPLETO");
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: "turnComplete" }));
            }
          }
        },

        onclose: (e) => {
          console.log(`⚪ GOOGLE CERRÓ CONEXIÓN: código ${e.code}, razón: ${e.reason}`);
        },

        onerror: (e) => {
          console.error("🔴 ERROR GEMINI:", e);
        },
      },
    });

    // FIX #3: Asignamos después del await, pero el callback ya puede usarlo
    ref.session = session;
    console.log("🔗 SESIÓN GEMINI ESTABLECIDA");

    // Recibimos audio del frontend y lo mandamos a Gemini
    ws.on("message", async (data) => {
      try {
        const msg = JSON.parse(data.toString());

        // FIX #5: Solo enviamos audio cuando Gemini está lista
        if (msg.type === "audio" && ref.session && ref.ready) {
          ref.session.send({
            realtimeInput: {
              mediaChunks: [
                {
                  mimeType: "audio/pcm;rate=16000",
                  data: msg.audio,
                },
              ],
            },
          });
        }
      } catch (e) {
        console.error("❌ Error procesando mensaje del cliente:", e.message);
      }
    });

    ws.on("close", () => {
      console.log("🔴 CLIENTE DESCONECTADO");
      if (ref.session) {
        try {
          ref.session.close();
        } catch (e) {
          console.error("Error cerrando sesión:", e.message);
        }
      }
    });

  } catch (err) {
    console.error("❌ ERROR CRÍTICO AL CONECTAR CON GEMINI:", err.message, err);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "error", message: err.message }));
      ws.close();
    }
  }
});
