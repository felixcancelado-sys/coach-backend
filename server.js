import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI } from "@google/genai";

const PORT = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocketServer({ server });

// 1. Inicialización directa y robusta
const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY);

server.listen(PORT, () => {
  console.log(`🚀 KORE BACKEND READY ON PORT ${PORT}`);
});

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENTE CONECTADO");

  try {
    // 2. Usamos el método directamente sobre la instancia genAI
    // El modelo Flash 2.0 es el que necesitamos para velocidad KORE
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash-exp" 
    });

    // 3. Iniciamos un chat que soporte envío de archivos/audio
    const chat = model.startChat();
    console.log("🧠 MOTOR KORE INICIALIZADO");

    ws.on("message", async (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "audio" && msg.audio) {
          // Enviamos el audio a Gemini
          const result = await chat.sendMessage([
            {
              inlineData: {
                mimeType: "audio/pcm;rate=16000",
                data: msg.audio
              }
            },
            { text: "Responde de forma breve y natural en español." }
          ]);

          const responseText = result.response.text();
          
          // Enviamos la respuesta de texto (o audio si configuramos el stream)
          ws.send(JSON.stringify({ 
            type: "text", 
            text: responseText 
          }));
        }
      } catch (e) {
        console.error("⚠️ Error procesando mensaje:", e.message);
      }
    });

  } catch (err) {
    // Si llegamos acá, es que el motor no arrancó
    console.error("❌ ERROR CRÍTICO MOTOR:", err.message);
    ws.send(JSON.stringify({ type: "error", content: "Error al despertar a Aoede" }));
  }

  ws.on("close", () => {
    console.log("🔴 CLIENTE DESCONECTADO");
  });
});
