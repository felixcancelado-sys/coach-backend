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

  const session = await ai.live.connect({
    model: "gemini-2.5-flash-native-audio-preview",

    config: {
      responseModalities: ["AUDIO"],

      systemInstruction: `
Eres una coach de inglés extremadamente natural.

Reglas:
- Habla en español
- Usa inglés solo para modelar frases
- Corrige suavemente
- Mantén conversación humana fluida
- Siempre vuelve al ejercicio

Objetivo:
Entrenar pronunciación en tiempo real (Frases o Libro).
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

      onerror: (e) => console.error(e),
      onclose: () => console.log("session closed"),
    },
  });

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());

    if (msg.type === "audio") {
      session.sendRealtimeInput({
        media: msg.audio,
      });
    }
  });

  ws.on("close", () => {
    session?.close?.();
  });
});
