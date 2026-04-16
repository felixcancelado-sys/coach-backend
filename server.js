import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI } from "@google/genai";

const PORT = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocketServer({ server });

// Verificación de API KEY
const apiKey = process.env.GEMINI_API_KEY;

server.listen(PORT, () => {
  console.log(`🚀 KORE BACKEND READY ON PORT ${PORT}`);
});

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENTE CONECTADO");

  try {
    if (!apiKey) throw new Error("GEMINI_API_KEY no configurada en Railway");

    // FORMA DE EMERGENCIA: Inicializamos y sacamos el modelo en un solo paso
    const genAI = new GoogleGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    // Probamos si la función existe antes de seguir
    if (typeof model.startChat !== 'function') {
      throw new Error("El SDK no cargó correctamente las funciones de chat");
    }

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
        console.error("⚠️ Error en mensaje:", e.message);
      }
    });

  } catch (err) {
    console.error("❌ ERROR DETECTADO:", err.message);
    ws.send(JSON.stringify({ type: "error", message: err.message }));
  }

  ws.on("close", () => console.log("🔴 CLIENTE DESCONECTADO"));
});
