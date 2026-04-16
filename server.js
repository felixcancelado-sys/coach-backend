import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI } from "@google/genai";

const PORT = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocketServer({ server });

const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY);

server.listen(PORT, () => {
  console.log("🚀 KORE BACKEND READY ON PORT " + PORT);
});

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENTE CONECTADO");

  let session;

  try {
    // Usamos el modelo 2.0 que es el que tiene voz nativa fluida
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    session = await model.live.connect({
      config: {
        responseModalities: ["AUDIO"],
        systemInstruction: {
          parts: [{ text: "Eres Aoede, coach de inglés de My Team. Habla en español, sé amable y ayuda con la pronunciación. Sé breve y natural." }]
        }
      }
    });

    // Escuchar respuesta de Gemini y mandar al Frontend
    (async () => {
      try {
        for await (const response of session.receive()) {
          const audioData = response.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          if (audioData) {
            ws.send(JSON.stringify({ type: "audio", audio: audioData }));
          }
        }
      } catch (err) {
        console.log("🔴 Sesión de Gemini cerrada");
      }
    })();

    // Recibir audio del Frontend y mandar a Gemini
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "audio" && msg.audio) {
          session.sendRealtimeInput([{
            media: {
              mimeType: "audio/pcm;rate=16000",
              data: msg.audio // Ya viene en base64 desde el front
            }
          }]);
        }
      } catch (e) {
        console.error("Error procesando mensaje:", e);
      }
    });

    ws.on("close", () => {
      console.log("🔴 CLIENTE DESCONECTADO");
      session?.close();
    });

  } catch (err) {
    console.error("❌ ERROR DE SESIÓN:", err);
  }
});
