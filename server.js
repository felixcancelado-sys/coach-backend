import http from "http";
import { WebSocketServer } from "ws";
import fetch from "node-fetch";

const PORT = process.env.PORT || 8080;

const server = http.createServer();
const wss = new WebSocketServer({ server });

server.listen(PORT, () => {
  console.log("🚀 Backend VOZ PRO iniciado");
});

// 🎤 VOICE ID
const VOICE_ID = "XfNU2rGpBa01ckF309OY";

wss.on("connection", (ws) => {
  console.log("🟢 Frontend conectado");

  let isProcessing = false;
  let lastText = "";

  // 🧠 NUEVO: instruction por sesión
  ws.sessionInstruction = null;

  ws.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg.toString());

      // 🚀 NUEVO: inicio de sesión con prompt dinámico
      if (data.type === "start_session") {
        ws.sessionInstruction = data.instruction;
        console.log("🧠 Instruction recibida");
        return;
      }

      const text = data?.text?.trim();

      console.log("🎤 Usuario:", text);

      if (!text || text.length < 2) return;

      if (text === lastText) {
        console.log("⚠️ duplicado ignorado");
        return;
      }

      if (isProcessing) {
        console.log("⚠️ busy, ignorado");
        return;
      }

      lastText = text;
      isProcessing = true;

      // 🧠 USO DEL PROMPT DINÁMICO (si existe)
      const coachPrefix =
        ws.sessionInstruction
          ? "Repeat after me:"
          : "Repeat after me:";

      const reply = `${coachPrefix} ${text}`;

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
