import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI } from "@google/genai";

// Configuración de Puerto para Railway
const PORT = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocketServer({ server });

// Inicialización de Google AI
const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY);

server.listen(PORT, () => {
  console.log(`🚀 KORE BACKEND READY ON PORT ${PORT}`);
});

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENTE CONECTADO");

  let session;

  try {
    // Referencia al modelo 2.0 Flash
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    // Conexión al canal Live (Voz Nativa)
    session = await model.live.connect({
      config: {
        responseModalities: ["AUDIO"],
        systemInstruction: {
          parts: [{ text: "Eres Aoede, coach de inglés de My Team. Habla en español, sé breve, natural y ayuda con la pronunciación." }]
        }
      }
    });

    // Bucle para recibir audio de Gemini y mandarlo al navegador
    (async () => {
      try {
        for await (const response of session.receive()) {
          const audioData = response.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          if (audioData) {
            ws.send(JSON.stringify({ type: "audio", audio: audioData }));
          }
        }
      } catch (err) {
        console.log("🔴 Sesión Gemini finalizada");
      }
    })();

    // Recibir audio de Félix y mandarlo a Gemini
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "audio" && msg.audio && session) {
          session.sendRealtimeInput([{
            media: {
              mimeType: "audio/pcm;rate=16000",
              data: msg.audio
            }
          }]);
        }
      } catch (e) {
        // Silenciamos errores menores de parseo
      }
    });

    ws.on("close", () => {
      console.log("🔴 CLIENTE DESCONECTADO");
      if (session) session.close();
    });

  } catch (err) {
    console.error("❌ ERROR DE SESIÓN:", err.message);
    ws.send(JSON.stringify({ type: "error", message: err.message }));
  }
});
