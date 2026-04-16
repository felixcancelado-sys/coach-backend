import http from "http";
import { WebSocketServer } from "ws";
import fetch from "node-fetch";

const PORT = process.env.PORT || 8080;

const server = http.createServer();
const wss = new WebSocketServer({ server });

server.listen(PORT, () => {
  console.log("🚀 COACH INTELIGENTE ONLINE");
});

// 🎤 VOICE
const VOICE_ID = "XfNU2rGpBa01ckF309OY";

// 🧠 GEMINI
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ELEVEN_KEY = process.env.ELEVEN_KEY;

// 🧠 GEMINI FUNCTION
async function askGemini(instruction, userText) {
  const prompt = `
Eres una coach de inglés llamada My Team Coach.

REGLAS IMPORTANTES:
- No eres un repetidor.
- No digas "repeat after me" siempre.
- Solo lo usas cuando el usuario está practicando pronunciación.
- Mantienes conversación natural.
- Explicas en español.
- Das frases en inglés solo cuando enseñes.

CONTEXTO DE CLASE:
${instruction || "Conversación libre"}

USUARIO DIJO:
"${userText}"

Responde como una coach humana, natural, motivadora y educativa.
`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    }
  );

  const data = await res.json();

  return (
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    "Let’s continue practicing English together."
  );
}

// 🚀 WS SERVER
wss.on("connection", (ws) => {
  console.log("🟢 Frontend conectado");

  let isProcessing = false;
  let lastText = "";

  ws.sessionInstruction = "";

  ws.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg.toString());

      // 🧠 INICIO DE SESIÓN
      if (data.type === "start_session") {
        ws.sessionInstruction = data.instruction;
        console.log("🧠 Instruction recibida");
        return;
      }

      const text = data?.text?.trim();

      if (!text || text.length < 2) return;

      if (text === lastText || isProcessing) return;

      lastText = text;
      isProcessing = true;

      console.log("🎤 Usuario:", text);

      // 🧠 GEMINI (COACH REAL)
      const coachReply = await askGemini(
        ws.sessionInstruction,
        text
      );

      console.log("🧠 Coach:", coachReply);

      // 🔊 ELEVENLABS (SOLO VOZ)
      const audioRes = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
        {
          method: "POST",
          headers: {
            "xi-api-key": ELEVEN_KEY,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text: coachReply,
            model_id: "eleven_multilingual_v2",
          }),
        }
      );

      if (!audioRes.ok) {
        console.log("❌ TTS ERROR:", await audioRes.text());
        return;
      }

      const audioBuffer = await audioRes.arrayBuffer();
      const base64 = Buffer.from(audioBuffer).toString("base64");

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
