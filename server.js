import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI } from "@google/genai";

const PORT = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocketServer({ server });

// Corregido: La API Key se pasa directamente como string
const ai = new GoogleGenAI(process.env.GEMINI_API_KEY);

server.listen(PORT, () => {
  console.log("🚀 BACKEND READY ON PORT", PORT);
});

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENT CONNECTED");

  let session;

  try {
    // 1. Obtener el modelo primero (Obligatorio en versiones nuevas)
    const model = ai.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    // 2. Conectar al modo Live usando el nombre correcto del modelo
    session = await (model as any).live.connect({
      config: {
        responseModalities: ["AUDIO"],
        systemInstruction: {
          parts: [{ text: "Eres una coach de inglés. Hablas español. Corriges pronunciación con amabilidad. Siempre vuelves al ejercicio." }]
        }
      }
    });

    // Escuchar mensajes de Gemini
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
        console.log("🔴 Stream Gemini cerrado");
      }
    })();

    ws.on("message", (data) => {
      if (!session) return;
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "audio") {
          const audio = msg.audio;
          if (!Array.isArray(audio)) return;

          const pcm16 = new Int16Array(audio.length);
          for (let i = 0; i < audio.length; i++) {
            const v = Math.max(-1, Math.min(1, audio[i]));
            pcm16[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
          }

          session.sendRealtimeInput([{
            media: {
              mimeType: "audio/pcm;rate=16000",
              data: btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)))
            }
          }]);
        }

        if (msg.type === "text") {
          session.sendRealtimeInput([{ text: msg.text }]);
        }
      } catch (err) {
        console.error("⚠️ Error procesando mensaje del front:", err.message);
      }
    });

    ws.on("close", () => {
      console.log("🔴 CLIENT DISCONNECTED");
      session?.close?.();
    });

  } catch (err) {
    console.error("❌ SESSION ERROR:", err.message);
  }
});
