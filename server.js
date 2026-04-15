import http from "http";
import { WebSocketServer } from "ws";
import WebSocket from "ws";

const GEMINI_KEY = process.env.GEMINI_KEY;

const server = http.createServer();
const wss = new WebSocketServer({ server });

console.log("🚀 Backend coach iniciado (NO SDK)");

wss.on("connection", (client) => {
  console.log("🟢 Frontend conectado");

  const gemini = new WebSocket(
    `wss://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-native-audio-latest:bidiGenerateContent?key=${GEMINI_KEY}`
  );

  // 🧠 LOGS CLAVE (AQUÍ ES DONDE VAN)
  gemini.on("open", () => {
    console.log("🧠 GEMINI OPEN OK");

    gemini.send(
      JSON.stringify({
        setup: {
          systemInstruction: {
            parts: [
              {
                text: `
Eres un coach de inglés en tiempo real.
Corriges pronunciación.
Sé breve y directo.
Siempre pide repetir.
                `,
              },
            ],
          },
        },
      })
    );
  });

  gemini.on("error", (e) => {
    console.log("❌ GEMINI ERROR:", e.message);
  });

  gemini.on("close", () => {
    console.log("🔴 GEMINI CLOSED");
  });

  // 🎤 FRONTEND → GEMINI
  client.on("message", (msg) => {
    try {
      if (gemini.readyState === WebSocket.OPEN) {
        gemini.send(msg);
      }
    } catch (err) {
      console.log("❌ ERROR sending audio:", err.message);
    }
  });

  // 🔊 GEMINI → FRONTEND
  gemini.on("message", (msg) => {
    try {
      client.send(msg);
    } catch (err) {
      console.log("❌ ERROR sending to client:", err.message);
    }
  });

  client.on("close", () => {
    console.log("🔴 Frontend disconnected");
    gemini.close();
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Listening on ${PORT}`);
});
