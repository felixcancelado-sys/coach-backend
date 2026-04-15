import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI } from "@google/genai";

const GEMINI_KEY = process.env.GEMINI_KEY;

// 🚀 HTTP server obligatorio en Railway
const server = http.createServer();
const wss = new WebSocketServer({ server });

console.log("🚀 Coach backend iniciado");

const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });

wss.on("connection", async (client) => {
  console.log("🟢 Frontend conectado");

  // 🧠 Conexión LIVE a Gemini (SDK oficial)
  const session = await ai.live.connect({
    model: "gemini-2.5-flash-native-audio",
    config: {
      responseModalities: ["AUDIO"],
      systemInstruction: {
        parts: [
          {
            text: `
Eres un coach de inglés en tiempo real.

Reglas:
- Corrige pronunciación
- Di "repeat after me"
- Sé breve
- Interactivo y natural
            `,
          },
        ],
      },
    },

    callbacks: {
      onopen: () => {
        console.log("🧠 Gemini conectado");
      },

      onmessage: (msg) => {
        // 🔊 Gemini → frontend
        client.send(JSON.stringify(msg));
      },

      onerror: (err) => {
        console.error("❌ Gemini error:", err);
      },

      onclose: () => {
        console.log("🔴 Gemini cerrado");
        client.close();
      },
    },
  });

  // 🎤 frontend → Gemini
  client.on("message", (msg) => {
    try {
      session.sendRealtimeInput({
        media: {
          data: msg.toString("base64"),
          mimeType: "audio/pcm",
        },
      });
    } catch (e) {
      console.error("❌ error enviando audio:", e);
    }
  });

  client.on("close", () => {
    console.log("🔴 Frontend desconectado");
    session.close?.();
  });
});

// 🚀 PORT Railway
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Listening on port ${PORT}`);
});
