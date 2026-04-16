import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI } from "@google/genai";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 8080;

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

app.get("/", (_, res) => {
  res.send("🟢 Gemini Live Streaming Gateway");
});

wss.on("connection", async (ws) => {
  console.log("🟢 Client connected");

  let session;

  try {
    session = await ai.live.connect({
      model: "gemini-2.5-flash-native-audio-preview",

      config: {
        responseModalities: ["AUDIO"],

        systemInstruction: `
Eres una coach de inglés llamada My Team.

Reglas:
- Habla en español
- Usa inglés solo para modelar palabras
- Corrige suavemente
- Mantén conversación natural

Flujo:
- practicar pronunciación
- responder preguntas del usuario
- volver al ejercicio siempre
        `,
      },

      callbacks: {
        onopen: () => {
          console.log("🧠 Gemini Live session opened");
        },

        onmessage: (msg) => {
          const parts = msg.serverContent?.modelTurn?.parts;

          if (!parts) return;

          for (const part of parts) {
            if (part.inlineData?.data) {
              ws.send(
                JSON.stringify({
                  type: "audio",
                  data: part.inlineData.data,
                })
              );
            }
          }
        },

        onerror: (e) => {
          console.error("❌ Gemini error", e);
        },

        onclose: () => {
          console.log("🔴 Gemini session closed");
        },
      },
    });

    ws.on("message", (data) => {
      // audio chunk desde frontend
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "audio") {
          session.sendRealtimeInput({
            media: msg.data,
          });
        }

        if (msg.type === "text") {
          session.sendRealtimeInput({
            text: msg.text,
          });
        }
      } catch (e) {
        console.log("invalid message");
      }
    });

    ws.on("close", () => {
      console.log("🔴 client disconnected");
      session?.close?.();
    });
  } catch (err) {
    console.error("❌ session error", err);
  }
});

server.listen(PORT, () => {
  console.log("🚀 Live streaming backend running on", PORT);
});
