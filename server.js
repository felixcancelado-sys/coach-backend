import WebSocket, { WebSocketServer } from "ws";
import fetch from "node-fetch";

const PORT = process.env.PORT || 8080;

const GEMINI_KEY = process.env.GEMINI_KEY;
const ELEVEN_KEY = process.env.ELEVEN_KEY;
const VOICE_ID = "EXAVITQu4vr4xnSDxMaL"; // puedes cambiar luego

const wss = new WebSocketServer({ port: PORT });

console.log("🚀 Backend entrenador iniciado");

wss.on("connection", (ws) => {
  console.log("🟢 Frontend conectado");

  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (!data.text) return;

      const userText = data.text;

      // 🧠 PROMPT ENTRENADOR
      const prompt = `
You are an English trainer for Spanish speakers.

User said: "${userText}"

Your job:
1. Detect mistakes
2. Correct them
3. Explain briefly in Spanish
4. Provide correct sentence in English
5. Ask to repeat

Format:

Motivación en español

Explicación breve

Frase correcta:
"Correct sentence"

Pide repetir
`;

      // 🧠 GEMINI
      const gRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
          }),
        }
      );

      const gData = await gRes.json();

      const reply =
        gData?.candidates?.[0]?.content?.parts?.[0]?.text ||
        "Intenta otra vez";

      console.log("🧠 Gemini:", reply);

      // 🔊 ELEVENLABS
      const tts = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
        {
          method: "POST",
          headers: {
            "xi-api-key": ELEVEN_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: reply,
            model_id: "eleven_multilingual_v2",
            voice_settings: {
              stability: 0.4,
              similarity_boost: 0.8,
              style: 0.7,
              use_speaker_boost: true,
            },
          }),
        }
      );

      const audioBuffer = await tts.arrayBuffer();
      const base64 = Buffer.from(audioBuffer).toString("base64");

      ws.send(JSON.stringify({ audio: base64 }));
    } catch (err) {
      console.error("❌ ERROR:", err.message);
    }
  });

  ws.on("close", () => console.log("🔴 Frontend desconectado"));
});
