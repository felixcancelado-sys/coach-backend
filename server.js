import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI } from "@google/genai";

const PORT = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocketServer({ server });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

server.listen(PORT, () => {
  console.log("🚀 BACKEND READY ON PORT", PORT);
});

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENT CONNECTED");

  let session;

  try {
    session = await ai.live.connect({
      model: "gemini-2.0-flash-exp",
      config: {
        responseModalities: ["AUDIO"],
        systemInstruction: {
          parts: [{ text: "Eres una coach de inglés amable llamada Aoede. Hablas español y ayudas con la pronunciación." }]
        }
      },
      callbacks: {
        onmessage: (msg) => {
          const parts = msg.serverContent?.modelTurn?.parts;
          if (!parts) return;

          for (const part of parts) {
            if (part.inlineData?.data) {
              ws.send(JSON.stringify({
                type: "audio",
                audio: part.inlineData.data,
              }));
            }
          }
        },
        onerror: (err) => {
          console.error("🔴 ERROR DE GEMINI:", err);
        },
        onclose: (e) => {
          // AHORA VEREMOS EXACTAMENTE EL CÓDIGO DEL CORTE
          console.log(`🔴 STREAM CERRADO POR GEMINI. Código: ${e.code}, Razón: ${e.reason || "Sin especificar"}`);
        }
      }
    });

    console.log("🧠 MOTOR KORE DESPIERTO Y ESCUCHANDO");

    // 🔥 EL TEST DEFINITIVO: Obligamos a Aoede a hablar apenas se conecta
    setTimeout(async () => {
      if (session && typeof session.send === 'function') {
        console.log("🗣️ Forzando saludo inicial de Aoede...");
        try {
          await session.send({
            clientContent: {
              turns: [{ role: "user", parts: [{ text: "Hola Aoede, preséntate brevemente en español y dime que me escuchas." }] }],
              turnComplete: true
            }
          });
        } catch (err) {
          console.error("⚠️ Error forzando el saludo:", err.message);
        }
      }
    }, 1000); // Esperamos 1 segundo y le mandamos el texto

    ws.on("message", async (data) => {
      if (!session) return;
      try {
        const msg = JSON.parse(data.toString());

        // Evitamos enviar arrays vacíos que hacen que Gemini corte la llamada
        if (msg.type === "audio" && Array.isArray(msg.audio) && msg.audio.length > 0) {
          const pcm16 = new Int16Array(msg.audio.length);
          for (let i = 0; i < msg.audio.length; i++) {
            const v = Math.max(-1, Math.min(1, msg.audio[i]));
            pcm16[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
          }

          const base64Audio = Buffer.from(pcm16.buffer).toString("base64");

          if (typeof session.send === 'function') {
            await session.send({
              realtimeInput: {
                mediaChunks: [{
                  mimeType: "audio/pcm;rate=16000",
                  data: base64Audio
                }]
              }
            });
          }
        }
      } catch (err) {
        // Silenciamos los errores de parseo del front para no saturar el log
      }
    });

    ws.on("close", () => {
      console.log("🔴 CLIENT DISCONNECTED");
      session = null;
    });

  } catch (err) {
    console.error("❌ ERROR CRÍTICO AL CONECTAR:", err.message);
  }
});
