import http from "http";
import { WebSocketServer } from "ws";
import WebSocket from "ws";

const GEMINI_KEY = process.env.GEMINI_KEY;

const server = http.createServer();
const wss = new WebSocketServer({ server });

console.log("🚀 Backend coach iniciado (NO SDK)");

wss.on("connection", (client) => {
  console.log("🟢 Frontend conectado");

  // 🧠 Conexión directa a Gemini Live (PROTOCOLO CORRECTO)
  const gemini = new WebSocket(
    `wss://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-native-audio-latest:bidiGenerateContent?key=${GEMINI_KEY}`
  );

  gemini.on("open", () => {
    console.log("🧠 Gemini conectado");

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

  // 🎤 FRONTEND → GEMINI
  client.on("message", (msg) => {
    try {
      if (gemini.readyState === WebSocket.OPEN) {
        gemini.send(msg);
      }
    } catch (err) {
      console.error("❌ error sending to Gemini:", err);
    }
  });

  // 🔊 GEMINI → FRONTEND
  gemini.on("message", (msg) => {
    try {
      client.send(msg);
    } catch (err) {
      console.error("❌ error sending to client:", err);
    }
  });

  gemini.on("error", (err) => {
    console.error("❌ Gemini error:", err.message);
  });

  gemini.on("close", () => {
    console.log("🔴 Gemini cerrado");
    client.close();
  });

  client.on("close", () => {
    console.log("🔴 Frontend desconectado");
    gemini.close();
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Listening on ${PORT}`);
});
