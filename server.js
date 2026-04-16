import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI } from "@google/genai";

const PORT = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocketServer({ server });

// Inicialización estándar para ESM
const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY);

server.listen(PORT, () => {
  console.log(`🚀 KORE BACKEND READY ON PORT ${PORT}`);
});

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENTE CONECTADO");

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    const chat = model.startChat();
    console.log("🧠 MOTOR KORE DESPIERTO");

    ws.on("message", async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "audio" && msg.audio) {
          const result = await chat.sendMessage([
            {
              inlineData: {
                mimeType: "audio/pcm;rate=16000",
                data: msg.audio
              }
            },
            { text: "Responde brevemente en español." }
          ]);
          
          ws.send(JSON.stringify({ 
            type: "text", 
            text: result.response.text() 
          }));
        }
      } catch (e) {
        console.error("⚠️ Error:", e.message);
      }
    });

  } catch (err) {
    console.error("❌ ERROR CRÍTICO:", err.message);
  }

  ws.on("close", () => console.log("🔴 CLIENTE DESCONECTADO"));
});
