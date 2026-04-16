import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI } from "@google/genai";

const PORT = process.env.PORT || 8080;

const server = http.createServer();
const wss = new WebSocketServer({ server });

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

server.listen(PORT, () => {
  console.log("🚀 LIVE SERVER READY");
});

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENT CONNECTED");

  let session;

  try {
    session = await ai.live.connect({
      model: "gemini-2.5-flash-native-audio-preview",

      config: {
        responseModalities: ["AUDIO"],

        systemInstruction: `
Eres una coach de inglés natural.

Reglas:
- Habla en español
- Usa inglés solo para modelar frases
- Corrige con amabilidad
- Mantén conversación fluida y humana
- Siempre vuelve al ejercicio (pronunciación)
        `,
      },

      callbacks: {
        onmessage: (msg) => {
          const parts = msg.serverContent?.modelTurn?.parts;

          if (!parts) return;

          for (const part of parts) {
            if (part.inlineData?.data) {
              ws.send(
                JSON.stringify({
                  type: "audio",
                  audio: part.inlineData.data,
                })
              );
            }
          }
        },

        onerror: (e) => {
          console.error("❌ Gemini error:", e);
        },

        onclose: () => {
          console.log("🔴 session closed");
        },
      },
    });

    // 🎤 INPUT DEL FRONTEND
    ws.on("message", (data) => {
      if (!session) return;

      try {
        const msg = JSON.parse(data.toString());

        // 🔥 AUDIO STREAM (FIX FINAL)
        if (msg.type === "audio") {
          const audioArray = msg.audio;

          if (!Array.isArray(audioArray)) return;

          // convertir a PCM16 seguro
          const pcm16 = new Int16Array(audioArray.length);

          for (let i = 0; i < audioArray.length; i++) {
            const s = Math.max(-1, Math.min(1, audioArray[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }

          session.sendRealtimeInput({
            media: new Uint8Array(pcm16.buffer),
          });
        }

        // 🔤 TEXTO (fallback opcional)
        if (msg.type === "text") {
          session.sendRealtimeInput({
            text: msg.text,
          });
        }
      } catch (err) {
        console.log("invalid message", err);
      }
    });

    ws.on("close", () => {
      console.log("🔴 CLIENT DISCONNECTED");
      session?.close?.();
    });
  } catch (err) {
    console.error("❌ SESSION ERROR:", err);
  }
});
