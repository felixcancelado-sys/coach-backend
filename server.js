import http from "http";
import { WebSocketServer } from "ws";
import fetch from "node-fetch";

const PORT = process.env.PORT || 8080;

const ELEVEN_KEY = process.env.ELEVEN_KEY;
const VOICE_ID = "EXAVITQu4vr4xnSDxMaL";

const server = http.createServer();
const wss = new WebSocketServer({ server });

server.listen(PORT, () => {
  console.log("🚀 Backend VOZ PRO estable iniciado");
});

// 🔥 CONTROL GLOBAL ANTI DUPLICADOS
let isProcessing = false;
let lastText = "";

wss.on("connection", (ws) => {
  console.log("🟢 Frontend conectado");

  ws.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      const text = data?.text?.trim();

      console.log("🎤 Usuario:", text);

      // ❌ filtro básico
      if (!text || text.length < 2) return;

      // ❌ anti duplicado global
      if (text === lastText) {
        console.log("⚠️ Duplicado ignorado");
        return;
      }

      // ❌ evitar requests simultáneos
      if (isProcessing) {
        console.log("⚠️ Busy, ignorado");
        return;
      }

      lastText = text;
      isProcessing = true;

      // 🧠 frase mínima (optimizada costo)
      const reply = `Repeat: ${text}`;

      console.log("🧠 FRASE:", reply);

      const ttsRes = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
        {
          method: "POST",
          headers: {
            "xi-api-key": ELEVEN_KEY,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text: reply,
            model_id: "eleven_multilingual_v2",
          }),
        }
      );

      if (!ttsRes.ok) {
        const err = await ttsRes.text();
        console.error("❌ ELEVEN ERROR:", err);
        isProcessing = false;
        return;
      }

      const audioBuffer = await ttsRes.arrayBuffer();
      const base64 = Buffer.from(audioBuffer).toString("base64");

      console.log("🔊 AUDIO OK");

      ws.send(JSON.stringify({ audio: base64 }));

      isProcessing = false;
    } catch (err) {
      console.error("❌ ERROR BACKEND:", err);
      isProcessing = false;
    }
  });

  ws.on("close", () => {
    console.log("🔴 Frontend desconectado");
  });
});
