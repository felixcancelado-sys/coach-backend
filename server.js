import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI } from "@google/genai";

const PORT = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocketServer({ server });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

server.listen(PORT, () => {
  console.log("🚀 BACKEND READY ON PORT", PORT);
});

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENT CONNECTED");

  let session;

  try {
    // Conexión exitosa, ahora con CALLBACKS para que no se cierre
    session = await ai.live.connect({
      model: "gemini-2.0-flash-exp",
      config: {
        responseModalities: ["AUDIO"],
        systemInstruction: {
          parts: [{ text: "Eres una coach de inglés amable llamada Aoede. Hablas español y ayudas con la pronunciación." }]
        }
      },
      // VOLVEMOS A TU LÓGICA ORIGINAL PARA MANTENER EL STREAM VIVO
      callbacks: {
        onmessage: (msg) => {
          const parts = msg.serverContent?.modelTurn?.parts;
          if (!parts) return;

          for (const part of parts) {
            if (part.inlineData?.data) {
              ws.send(JSON.stringify({
                type: "audio",
                audio: part.inlineData.data,
              }));
            }
          }
        },
        onerror: (e) => {
          console.error("🔴 GEMINI STREAM ERROR:", e.message || e);
        },
        onclose: () => {
          console.log("🔴 STREAM DE GEMINI CERRADO");
        }
      }
    });

    console.log("🧠 MOTOR KORE DESPIERTO Y ESCUCHANDO");

    // Recibir audio del Frontend
    ws.on("message", (data) => {
      if (!session) return;
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "audio" && Array.isArray(msg.audio)) {
          const pcm16 = new Int16Array(msg.audio.length);
          for (let i = 0; i < msg.audio.length; i++) {
            const v = Math.max(-1, Math.min(1, msg.audio[i]));
            pcm16[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
          }

          // Convertimos a base64 seguro para Node.js
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
        console.error("⚠️ Error procesando mensaje de Félix:", err.message);
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
