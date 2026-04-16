import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI } from "@google/genai";

const PORT = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocketServer({ server });

const ai = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { apiVersion: 'v1alpha' } 
});

server.listen(PORT, () => {
  console.log("🚀 BACKEND READY - AOEDE ONLINE");
});

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENT CONNECTED");
  let session;

  // Función para reenviar el audio al Frontend
  const handleAudio = (msg) => {
    const parts = msg.serverContent?.modelTurn?.parts || msg.modelTurn?.parts;
    if (parts) {
      parts.forEach(p => {
        if (p.inlineData?.data) {
          process.stdout.write("🔊"); // Si ves esto en Railway, Aoede ESTÁ HABLANDO
          ws.send(JSON.stringify({ type: "audio", audio: p.inlineData.data }));
        }
      });
    }
  };

  try {
    session = await ai.live.connect({
      model: "models/gemini-2.5-flash-native-audio-latest", 
      config: {
        responseModalities: ["AUDIO"],
        systemInstruction: {
          parts: [{ text: "Eres Aoede. Saluda de inmediato en español con voz muy clara." }]
        }
      },
      // MÉTODO 1: Por Callbacks
      callbacks: {
        onmessage: (msg) => handleAudio(msg),
        onerror: (e) => console.log("🔴 ERROR SESSION:", e)
      }
    });

    // MÉTODO 2: Por Eventos (Doble red)
    session.on("message", (msg) => handleAudio(msg));

    console.log("🧠 MOTOR KORE ACTIVO");

    // Saludo forzado con un texto más simple
    setTimeout(async () => {
      if (session) {
        console.log("🗣️ Enviando 'Hola' para despertar a Aoede...");
        try {
          await session.send("Hola Aoede, ¿puedes hablarme en español?");
        } catch (e) {
          console.log("Error al enviar texto inicial");
        }
      }
    }, 1500);

    ws.on("message", async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "audio" && session) {
          let base64 = typeof msg.audio === "string" ? msg.audio : Buffer.from(new Int16Array(msg.audio).buffer).toString("base64");
          
          await session.send({ 
            realtimeInput: { 
              mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: base64 }] 
            } 
          });
        }
      } catch (e) {}
    });

    ws.on("close", () => {
      console.log("🔴 CLIENT DISCONNECTED");
      if (session) session.close();
    });

  } catch (err) {
    console.error("❌ ERROR CRÍTICO:", err.message);
  }
});


   
