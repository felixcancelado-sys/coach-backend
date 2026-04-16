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
        // Directo en config, como lo pidió Railway
        responseModalities: ["AUDIO"],
        systemInstruction: {
          parts: [{ text: "Eres una coach de inglés amable llamada Aoede. Hablas español y ayudas con la pronunciación." }]
        }
      },
      // LA MAGIA DE JAVASCRIPT: Escuchamos con callbacks
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
        onclose: () => {
          console.log("🔴 STREAM CERRADO POR GEMINI");
        }
      }
    });

    console.log("🧠 MOTOR KORE DESPIERTO Y ESCUCHANDO");

    // Recibimos audio del navegador de Félix
    ws.on("message", async (data) => {
      if (!session) return;
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "audio" && Array.isArray(msg.audio)) {
          const pcm16 = new Int16Array(msg.audio.length);
          for (let i = 0; i < msg.audio.length; i++) {
            const v = Math.max(-1, Math.min(1, msg.audio[i]));
            pcm16[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
          }

          const base64Audio = Buffer.from(pcm16.buffer).toString("base64");

          // Compatibilidad blindada para el SDK
          if (typeof session.send === 'function') {
            await session.send({
              realtimeInput: {
                mediaChunks: [{
                  mimeType: "audio/pcm;rate=16000",
                  data: base64Audio
                }]
              }
            });
          } else if (typeof session.sendRealtimeInput === 'function') {
            session.sendRealtimeInput([{
              mimeType: "audio/pcm;rate=16000",
              data: base64Audio
            }]);
          }
        }

        if (msg.type === "text") {
          if (typeof session.send === 'function') {
             await session.send({
               clientContent: {
                 turns: [{ role: "user", parts: [{ text: msg.text }] }],
                 turnComplete: true
               }
             });
          } else if (typeof session.sendRealtimeInput === 'function') {
             session.sendRealtimeInput([{ text: msg.text }]);
          }
        }
      } catch (err) {
        console.error("⚠️ Error enviando a Gemini:", err.message);
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
