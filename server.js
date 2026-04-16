import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI } from "@google/genai";

const PORT = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocketServer({ server });

const ai = new GoogleGenAI(process.env.GEMINI_API_KEY);

server.listen(PORT, () => {
  console.log("🚀 BACKEND READY ON PORT", PORT);
});

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENT CONNECTED");

  let session;

  try {
    const model = ai.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    // Eliminamos el "as any" que causaba el error
    session = await model.live.connect({
      config: {
        responseModalities: ["AUDIO"],
        systemInstruction: {
          parts: [{ text: "Eres una coach de inglés. Hablas español. Corriges pronunciación con amabilidad. Siempre vuelves al ejercicio." }]
        }
      }
    });

    // Receptor de Gemini
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

    // Receptor del Frontend
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
        console.error("⚠️ Error:", err.message);
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
