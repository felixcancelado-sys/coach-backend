import http from "http";
import { WebSocketServer } from "ws";
import fetch from "node-fetch";

const PORT = process.env.PORT || 8080;

const server = http.createServer();
const wss = new WebSocketServer({ server });

server.listen(PORT, () => {
  console.log("🚀 Backend PRO estable");
});

// 🔥 CONTROL GLOBAL POR CONEXIÓN
wss.on("connection", (ws) => {
  console.log("🟢 Frontend conectado");

  let isProcessing = false;
  let lastText = "";

  ws.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      const text = data?.text?.trim();

      if (!text || text.length < 2) return;

      // ❌ duplicado
      if (text === lastText) return;

      // ❌ lock de concurrencia
      if (isProcessing) {
        console.log("⚠️ Busy, ignorado");
        return;
      }

      lastText = text;
      isProcessing = true;

      const reply = `Repeat: ${text}`;

      console.log("🧠 FRASE:", reply);

      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${process.env.VOICE_ID}`,
        {
          method: "POST",
          headers: {
            "xi-api-key": process.env.ELEVEN_KEY,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text: reply,
            model_id: "eleven_multilingual_v2",
          }),
        }
      );

      if (!res.ok) {
        console.log("❌ TTS ERROR:", await res.text());
        return;
      }

      const audio = await res.arrayBuffer();
      const base64 = Buffer.from(audio).toString("base64");

      ws.send(JSON.stringify({ audio: base64 }));

    } catch (err) {
      console.log("❌ ERROR:", err);
    } finally {
      isProcessing = false;
    }
  });

  ws.on("close", () => {
    console.log("🔴 Frontend desconectado");
  });
});
