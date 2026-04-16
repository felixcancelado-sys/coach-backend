import http from "http";
import { WebSocketServer } from "ws";
import fetch from "node-fetch";

const PORT = process.env.PORT || 8080;

const server = http.createServer();
const wss = new WebSocketServer({ server });

server.listen(PORT, () => {
  console.log("🚀 Backend VOZ PRO iniciado");
});

// 🎤 TU VOICE ID (FIJO)
const VOICE_ID = "XfNU2rGpBa01ckF309OY";

// 🧠 control anti-duplicados
wss.on("connection", (ws) => {
  console.log("🟢 Frontend conectado");

  let isProcessing = false;
  let lastText = "";

  ws.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      const text = data?.text?.trim();

      console.log("🎤 Usuario:", text);

      // ❌ filtros base
      if (!text || text.length < 2) return;

      // ❌ evitar duplicados
      if (text === lastText) {
        console.log("⚠️ duplicado ignorado");
        return;
      }

      // ❌ evitar concurrencia
      if (isProcessing) {
        console.log("⚠️ busy, ignorado");
        return;
      }

      lastText = text;
      isProcessing = true;

      // 🧠 frase optimizada para voz natural
      const reply = `Repeat after me: ${text}`;

      console.log("🧠 FRASE:", reply);

      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
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
        const err = await res.text();
        console.log("❌ TTS ERROR:", err);
        isProcessing = false;
        return;
      }

      const audioBuffer = await res.arrayBuffer();
      const base64 = Buffer.from(audioBuffer).toString("base64");

      console.log("🔊 AUDIO OK");

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
