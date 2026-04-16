import http from "http";
import { WebSocketServer } from "ws";
import fetch from "node-fetch";

const PORT = process.env.PORT || 8080;
const ELEVEN_KEY = process.env.ELEVEN_KEY;

// 🔊 voz (puedes cambiar luego)
const VOICE_ID = "EXAVITQu4vr4xnSDxMaL";

const server = http.createServer();
const wss = new WebSocketServer({ server });

server.listen(PORT, () => {
  console.log("🚀 Backend VOZ PRO iniciado");
});

wss.on("connection", (ws) => {
  console.log("🟢 Frontend conectado");

  ws.on("message", async () => {
    try {
      console.log("🎤 Trigger recibido");

      // 🔥 SOLO FRASE (mínimo consumo)
      const reply = "I went yesterday.";

      console.log("🧠 FRASE:", reply);

      const ttsRes = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
        {
          method: "POST",
          headers: {
            "xi-api-key": ELEVEN_KEY,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg"
          },
          body: JSON.stringify({
            text: reply,
            model_id: "eleven_multilingual_v2"
          }),
        }
      );

      if (!ttsRes.ok) {
        const errText = await ttsRes.text();
        console.error("❌ ELEVEN ERROR:", errText);
        return;
      }

      const audioBuffer = await ttsRes.arrayBuffer();
      const base64Audio = Buffer.from(audioBuffer).toString("base64");

      console.log("🔊 Audio generado OK");

      ws.send(JSON.stringify({ audio: base64Audio }));

    } catch (err) {
      console.error("❌ ERROR:", err.message);
    }
  });

  ws.on("close", () => {
    console.log("🔴 Frontend desconectado");
  });
});
