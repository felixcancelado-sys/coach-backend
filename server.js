import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI } from "@google/genai";

const PORT = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocketServer({ server });

// Inicialización correcta de la NUEVA librería
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

server.listen(PORT, () => {
  console.log("🚀 BACKEND READY ON PORT", PORT);
});

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENT CONNECTED");

  let session;

  try {
    // EN EL NUEVO SDK LA CONEXIÓN ES DIRECTA
    session = await ai.live.connect({
      model: "gemini-2.0-flash-exp",
      config: {
        responseModalities: ["AUDIO"],
        systemInstruction: {
          parts: [{ text: "Eres una coach de inglés amable llamada Aoede. Hablas español y ayudas con la pronunciación." }]
        }
      }
    });

    console.log("🧠 MOTOR KORE DESPIERTO");

    // 1. Escuchar a Gemini y mandar audio al Frontend
    (async () => {
      try {
        for await (const msg of session.receive()) {
          const parts = msg.serverContent?.modelTurn?.parts;
          if (!parts) continue;

          for (const part of parts) {
            if (part.inlineData?.data) {
              ws.send(JSON.stringify({
                type: "audio",
                audio: part.inlineData.data,
              }));
            }
          }
        }
      } catch (e) {
        console.log("🔴 Stream de Gemini cerrado");
      }
    })();

    // 2. Escuchar al Frontend y mandar audio a Gemini
    ws.on("message", (data) => {
      if (!session) return;
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "audio" && Array.isArray(msg.audio)) {
          // Convertimos la matriz a PCM 16-bit
          const pcm16 = new Int16Array(msg.audio.length);
          for (let i = 0; i < msg.audio.length; i++) {
            const v = Math.max(-1, Math.min(1, msg.audio[i]));
            pcm16[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
          }

          // Node.js nativo para convertir audio a Base64 sin que falle
          const base64Audio = Buffer.from(pcm16.buffer).toString("base64");

          session.sendRealtimeInput([{
            inlineData: {
              mimeType: "audio/pcm;rate=16000",
              data: base64Audio
            }
          }]);
        }

        if (msg.type === "text") {
          session.sendRealtimeInput([{ text: msg.text }]);
        }
      } catch (err) {
        console.error("⚠️ Error procesando mensaje:", err.message);
      }
    });

    ws.on("close", () => {
      console.log("🔴 CLIENT DISCONNECTED");
      session = null;
    });

  } catch (err) {
    console.error("❌ ERROR CRÍTICO:", err.message);
  }
});
