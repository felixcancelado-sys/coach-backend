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
  console.log("🚀 BACKEND READY - ANTI 1006 MODE");
});

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENT CONNECTED");
  let session;

  // Latido constante para evitar que Railway o Cloudflare cierren por inactividad
  const keepAlive = setInterval(() => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "heartbeat", timestamp: Date.now() }));
    }
  }, 15000);

  try {
    session = await ai.live.connect({
      model: "models/gemini-2.5-flash-native-audio-latest", 
      config: {
        responseModalities: ["AUDIO"],
        systemInstruction: {
          parts: [{ text: "Eres Aoede, una coach de inglés. Responde siempre en español de forma breve." }]
        }
      },
      callbacks: {
        onmessage: (msg) => {
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
        onerror: (e) => console.log("🔴 ERROR GEMINI:", e),
        onclose: () => console.log("⚪ SESIÓN GOOGLE CERRADA")
      }
    });

    console.log("✅ GEMINI LISTO");

    ws.on("message", async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "audio" && session) {
          await session.send({ 
            realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: msg.audio }] } 
          });
        }
      } catch (e) {
        // Ignorar errores de parsing de pings
      }
    });

    ws.on("close", () => {
      clearInterval(keepAlive);
      console.log("🔴 CLIENT DISCONNECTED");
      if (session) session.close();
    });

  } catch (err) {
    console.error("❌ ERROR CRÍTICO:", err.message);
  }
});
