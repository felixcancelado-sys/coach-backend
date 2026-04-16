import http from "http";
import { WebSocketServer } from "ws";
import * as GoogleGenerativeAI from "@google/genai"; // Importación total

const PORT = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocketServer({ server });

// Usamos el constructor desde el espacio de nombres completo
const genAI = new GoogleGenerativeAI.GoogleGenerativeAI(process.env.GEMINI_API_KEY);

server.listen(PORT, () => {
  console.log(`🚀 KORE BACKEND READY ON PORT ${PORT}`);
});

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENTE CONECTADO");

  try {
    // Intentamos obtener el modelo de forma segura
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash-exp" 
    });

    // Iniciamos la sesión
    const chat = model.startChat();
    console.log("🧠 MOTOR KORE DESPIERTO");

    ws.on("message", async (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "audio" && msg.audio) {
          // Procesamos el audio
          const result = await chat.sendMessage([
            {
              inlineData: {
                mimeType: "audio/pcm;rate=16000",
                data: msg.audio
              }
            },
            { text: "Responde brevemente en español." }
          ]);

          const responseText = result.response.text();
          ws.send(JSON.stringify({ 
            type: "text", 
            text: responseText 
          }));
        }
      } catch (e) {
        console.error("⚠️ Error en proceso:", e.message);
      }
    });

  } catch (err) {
    console.error("❌ ERROR CRÍTICO MOTOR:", err.message);
    ws.send(JSON.stringify({ type: "error", content: "Error de inicialización" }));
  }

  ws.on("close", () => {
    console.log("🔴 CLIENTE DESCONECTADO");
  });
});
