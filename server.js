import WebSocket, { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3001;
const GEMINI_KEY = process.env.GEMINI_KEY;

// 🔥 WebSocket server (frontend ↔ backend)
const wss = new WebSocketServer({ port: PORT });

console.log("🚀 Backend running on port", PORT);

wss.on("connection", (client) => {
  console.log("🟢 Frontend conectado");

  // 🧠 Conexión a Gemini (SERVER SIDE ONLY)
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
Tu trabajo:
- Escuchar al usuario
- Corregir pronunciación
- Pedir repetición
- Ser breve, claro y dinámico
- Hablar en español con inglés modelado
                `,
              },
            ],
          },
        },
      })
    );
  });

  // 🔁 FRONTEND → GEMINI (audio PCM)
  client.on("message", (msg) => {
    try {
      gemini.send(msg);
    } catch (err) {
      console.error("❌ Error enviando a Gemini:", err);
    }
  });

  // 🔁 GEMINI → FRONTEND
  gemini.on("message", (msg) => {
    try {
      client.send(msg);
    } catch (err) {
      console.error("❌ Error enviando al cliente:", err);
    }
  });

  // 🔌 cierre limpio
  client.on("close", () => {
    console.log("🔴 Frontend desconectado");
    gemini.close();
  });

  gemini.on("close", () => {
    console.log("🔴 Gemini desconectado");
    client.close();
  });

  gemini.on("error", (err) => {
    console.error("❌ Gemini error:", err);
  });
});
