import http from "http";
import { WebSocketServer } from "ws";
import fetch from "node-fetch";

const GEMINI_KEY = process.env.GEMINI_KEY;

const server = http.createServer();
const wss = new WebSocketServer({ server });

console.log("🚀 Backend coach STABLE iniciado");

wss.on("connection", (client) => {
  console.log("🟢 Frontend conectado");

  let context = [];

  client.on("message", async (msg) => {
    try {
      // 🔥 AUDIO SIMPLIFICADO → lo tratamos como texto base64 (placeholder)
      const input = msg.toString("base64");

      context.push({ role: "user", parts: [{ text: "Student is speaking in English practice session" }] });

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: `
Eres un coach de inglés en tiempo real.
Corrige pronunciación.
Di "repeat after me".
Sé breve.

El usuario está practicando speaking.
Responde como profesor dinámico.
                    `,
                  },
                ],
              },
            ],
          }),
        }
      );

      const data = await response.json();

      const text =
        data?.candidates?.[0]?.content?.parts?.[0]?.text ||
        "Can you repeat after me?";

      // 🔊 enviamos texto al frontend (luego lo conviertes a voz en browser)
      client.send(JSON.stringify({ text }));
    } catch (err) {
      console.log("❌ error:", err.message);
    }
  });

  client.on("close", () => {
    console.log("🔴 Frontend desconectado");
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Listening on ${PORT}`);
});
