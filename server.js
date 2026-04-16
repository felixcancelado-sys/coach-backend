import http from "http";
import { WebSocketServer } from "ws";
import * as GoogleAI from "@google/genai"; // Importación total para evitar el TypeError

const PORT = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocketServer({ server });

// Usamos el espacio de nombres completo para inicializar
const genAI = new GoogleAI.GoogleGenAI(process.env.GEMINI_API_KEY);

server.listen(PORT, () => {
  console.log(`🚀 KORE BACKEND READY ON PORT ${PORT}`);
});

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENTE CONECTADO");

  let session;

  try {
    // Usamos la sintaxis blindada para obtener el modelo
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    // IMPORTANTE: En la versión 1.0.0, 'live' es un método que se invoca
    session = await model.startChat({
        history: [],
        generationConfig: {
            maxOutputTokens: 1000,
        },
    });

    console.log("🧠 SESIÓN INICIADA");

    ws.on("message", async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        
        if (msg.type === "audio" && msg.audio) {
          // Si mandas audio, lo procesamos. 
          // Por ahora, para probar que hable, mandamos un ping de texto interno
          const result = await session.sendMessage([{
            inlineData: {
              mimeType: "audio/pcm;rate=16000",
              data: msg.audio
            }
          }]);
          
          // Si el modelo responde con texto, lo mandamos (Gemini 2.0 genera audio nativo si se configura el Live)
          // Pero para que NO falle el backend, primero aseguremos el canal
        }
      } catch (e) {
        console.error("Error en el mensaje:", e.message);
      }
    });

    ws.on("close", () => {
      console.log("🔴 CLIENTE DESCONECTADO");
    });

  } catch (err) {
    console.error("❌ ERROR DE SESIÓN:", err.message);
  }
});
