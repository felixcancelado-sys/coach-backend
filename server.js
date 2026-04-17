import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI } from "@google/genai";

const PORT = process.env.PORT || 8080;
const server = http.createServer();
// Aumentamos el timeout del servidor
const wss = new WebSocketServer({ server, clientTracking: true });

const ai = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { apiVersion: 'v1alpha' } 
});

server.listen(PORT, () => {
  console.log("🚀 BACKEND READY - MODO ANTI-TIMEOUT");
});

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENT CONNECTED");
  let session;
  
  // MANTENER CONEXIÓN VIVA CON EL NAVEGADOR (Impide el cierre de Cloudflare)
  const pingInterval = setInterval(() => {
    if (ws.readyState === 1) ws.ping();
  }, 20000);

  try {
    session = await ai.live.connect({
      model: "models/gemini-2.5-flash-native-audio-latest", 
      config: {
        responseModalities: ["AUDIO"],
        systemInstruction: { parts: [{ text: "Eres Aoede. Responde breve." }] }
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
      } catch (e) {}
    });

    ws.on("close", () => {
      clearInterval(pingInterval);
      console.log("🔴 CLIENT DISCONNECTED");
      if (session) session.close();
    });

  } catch (err) {
    console.error("❌ ERROR:", err.message);
  }
});
