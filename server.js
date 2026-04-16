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
  console.log("🚀 BACKEND READY - AOEDE ESPERANDO...");
});

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENT CONNECTED");
  let session;

  try {
    session = await ai.live.connect({
      model: "models/gemini-2.5-flash-native-audio-latest", 
      config: {
        responseModalities: ["AUDIO"],
        systemInstruction: {
          parts: [{ text: "Eres Aoede, una coach de inglés amable. Responde siempre en español de forma breve." }]
        }
      },
      callbacks: {
        onmessage: (msg) => {
          if (msg.setupComplete) {
            console.log("✅ GEMINI LISTO PARA ESCUCHARTE");
          }

          const parts = msg.serverContent?.modelTurn?.parts;
          if (parts) {
            parts.forEach(p => {
              if (p.inlineData?.data) {
                process.stdout.write("🔊"); 
                ws.send(JSON.stringify({ type: "audio", audio: p.inlineData.data }));
              }
            });
          }
        },
        onerror: (e) => console.log("🔴 ERROR:", e),
        onclose: () => console.log("⚪ SESIÓN CERRADA")
      }
    });

    ws.on("message", async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "audio" && session) {
          // Si el audio viene del frontend viejo (Array) o nuevo (Base64)
          let base64 = typeof msg.audio === "string" 
            ? msg.audio 
            : Buffer.from(new Int16Array(msg.audio).buffer).toString("base64");
          
          await session.send({ 
            realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: base64 }] } 
          });
        }
      } catch (e) {}
    });

    ws.on("close", () => {
      console.log("🔴 CLIENT DISCONNECTED");
      if (session) session.close();
    });

  } catch (err) {
    console.error("❌ ERROR AL INICIAR:", err.message);
  }
});
