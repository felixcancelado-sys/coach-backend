import http from "http";
import { WebSocketServer } from "ws";
import * as GoogleAI from "@google/genai"; // Importamos todo el paquete

const PORT = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocketServer({ server });

// Usamos el constructor completo para evitar errores de referencia
const genAI = new GoogleAI.GoogleGenAI(process.env.GEMINI_API_KEY);

server.listen(PORT, () => {
  console.log("🚀 BACKEND READY ON PORT", PORT);
});

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENT CONNECTED");

  try {
    // PARCHE: Si genAI no tiene el método, lo buscamos en el prototipo
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    const session = await model.live.connect({
      config: {
        responseModalities: ["AUDIO"],
        systemInstruction: {
          parts: [{ text: "Eres una coach de inglés amable llamada Aoede. Hablas español y ayudas con la pronunciación." }]
        }
      }
    });

    console.log("🧠 MOTOR KORE DESPIERTO");

    // Receptor de Gemini -> Front
    (async () => {
      try {
        for await (const msg of session.receive()) {
          const data = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          if (data) {
            ws.send(JSON.stringify({ type: "audio", audio: data }));
          }
        }
      } catch (e) { console.log("🔴 Stream cerrado"); }
    })();

    // Receptor Front -> Gemini
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "audio" && Array.isArray(msg.audio)) {
          // Convertimos el audio a PCM16
          const pcm16 = new Int16Array(msg.audio.length);
          for (let i = 0; i < msg.audio.length; i++) {
            const v = Math.max(-1, Math.min(1, msg.audio[i]));
            pcm16[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
          }
          
          session.sendRealtimeInput([{
            media: {
              mimeType: "audio/pcm;rate=16000",
              data: btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)))
            }
          }]);
        }
      } catch (err) { console.error("⚠️ Error:", err.message); }
    });

    ws.on("close", () => {
      console.log("🔴 CLIENT DISCONNECTED");
      session?.close?.();
    });

  } catch (err) {
    console.error("❌ ERROR CRÍTICO:", err.message);
  }
});
