import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI } from "@google/genai";

const PORT = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocketServer({ server });

const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY);

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENTE CONECTADO A KORE");

  // Usamos el modelo Flash 2.0 que es el rey de la voz ahora
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

  // Iniciamos la sesión Live (Esto es lo que da voz natural sin ElevenLabs)
  let liveSession;

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === "audio") {
        // Enviamos el audio directo a Gemini
        // Gemini procesa el audio y genera la respuesta de voz automáticamente
        if (!liveSession) {
            liveSession = await model.startChat({
                // Configuración de voz nativa
            });
        }
        // Lógica de reenvío de chunks PCM
      }
    } catch (err) {
      console.error("❌ Error en el socket:", err);
    }
  });

  ws.on("close", () => console.log("🔴 CLIENTE DESCONECTADO"));
});

server.listen(PORT, () => console.log("🚀 KORE SERVER RUNNING"));
