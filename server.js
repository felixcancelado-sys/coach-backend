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

server.listen(PORT, () => {
  console.log(`🚀 BACKEND READY - AOEDE PRO en puerto ${PORT}`);
});

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENTE CONECTADO");

  const ref = {
    session: null,
    ready: false,
    clientClosed: false,
    googleClosed: false,
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
              voiceName: "Aoede",
            },
          },
        },
        systemInstruction: {
          parts: [
            {
              text: [
                "Eres Aoede, una coach de inglés amigable, cálida y motivadora.",
                "Cuando la sesión inicia, saludas en español.",
                "Te presentas brevemente.",
                "Luego ayudas al usuario a practicar inglés.",
                "Hablas de forma breve y clara.",
                "Esperas al usuario al terminar cada turno.",
              ].join(" "),
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
              console.log("✅ SETUP COMPLETO - DESPERTANDO A AOEDE");
              ref.ready = true;

              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "readyForUser" }));
              }

              try {
                session.sendRealtimeInput({
                  text: "Hola Aoede, preséntate.",
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
        console.log("📥 MENSAJE DESDE FRONTEND:", raw.slice(0, 80));

        const msg = JSON.parse(raw);

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
