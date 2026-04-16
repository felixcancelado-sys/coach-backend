import http from "http";
import { WebSocketServer } from "ws";
import * as GoogleAI from "@google/genai";

const PORT = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocketServer({ server });

server.listen(PORT, () => {
  console.log(`🚀 KORE BACKEND READY ON PORT ${PORT}`);
});

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENTE CONECTADO");

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Falta GEMINI_API_KEY");

    // PARCHE MAESTRO: Accedemos a la clase de forma dinámica
    // Esto evita el error de "is not a function" si la importación falló
    const GoogleGenAI = GoogleAI.GoogleGenAI || GoogleAI.default?.GoogleGenAI;
    
    if (!GoogleGenAI) {
      throw new Error("No se pudo encontrar la clase GoogleGenAI en la librería");
    }

    const genAI = new GoogleGenAI(apiKey);
    
    // Usamos el nombre del modelo tal cual lo pide la librería
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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
            { text: "Responde brevemente." }
          ]);
          ws.send(JSON.stringify({ type: "text", text: result.response.text() }));
        }
      } catch (e) {
        console.error("⚠️ Error:", e.message);
      }
    });

  } catch (err) {
    console.error("❌ ERROR DETECTADO:", err.message);
  }
});
