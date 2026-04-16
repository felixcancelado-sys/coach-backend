import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI } from "@google/genai";

const PORT = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocketServer({ server });

const ai = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { apiVersion: 'v1alpha' } 
});

server.listen(PORT, () => {
  console.log("🚀 BACKEND READY ON PORT", PORT);
});

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENT CONNECTED");

  let session;

  try {
    session = await ai.live.connect({
      // 🔥 ESTE ES EL NOMBRE QUE LA API ALPHA RECONOCE PARA AUDIO
      model: "models/gemini-2.0-flash-exp", 
      config: {
        responseModalities: ["AUDIO"],
        systemInstruction: {
          parts: [{ text: "Eres una coach de inglés amable llamada Aoede. Responde siempre en español." }]
        }
      },
      callbacks: {
        onmessage: (msg) => {
          if (msg.serverContent?.modelTurn?.parts) {
            const parts = msg.serverContent.modelTurn.parts;
            for (const part of parts) {
              if (part.inlineData?.data) {
                process.stdout.write("🔊"); 
                ws.send(JSON.stringify({ type: "audio", audio: part.inlineData.data }));
              }
            }
          }
        },
        onerror: (err) => console.error("🔴 ERROR DE GEMINI:", err),
        onclose: (e) => {
          console.log(`🔴 STREAM CERRADO POR GEMINI. Código: ${e.code}, Razón: ${e.reason}`);
        }
      }
    });

    console.log("🧠 MOTOR KORE DESPIERTO (Canal v1alpha)");

    // Saludo forzado
    setTimeout(async () => {
      if (session && typeof session.send === 'function') {
        try {
          await session.send({
            clientContent: { 
              turns: [{ role: "user", parts: [{ text: "Hola Aoede, preséntate brevemente." }] }],
              turnComplete: true 
            }
          });
        } catch (err) {}
      }
    }, 2000); 

    ws.on("message", async (data) => {
      if (!session) return;
      try {
        const msg = JSON.parse(data.toString());
        let base64Audio = null;

        if (msg.type === "audio") {
          if (Array.isArray(msg.audio)) {
            const pcm16 = new Int16Array(msg.audio.length);
            for (let i = 0; i < msg.audio.length; i++) {
              const v = Math.max(-1, Math.min(1, msg.audio[i]));
              pcm16[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
            }
            base64Audio = Buffer.from(pcm16.buffer).toString("base64");
          } else {
            base64Audio = msg.audio;
          }

          await session.send({
            realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: base64Audio }] }
          });
        }
      } catch (err) {}
    });

    ws.on("close", () => {
      console.log("🔴 CLIENT DISCONNECTED");
      session = null;
    });

  } catch (err) {
    console.error("❌ ERROR CRÍTICO AL CONECTAR:", err.message);
  }
});
