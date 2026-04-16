import http from "http";
import { WebSocketServer } from "ws";
import fetch from "node-fetch";

const PORT = process.env.PORT || 8080;

const server = http.createServer();
const wss = new WebSocketServer({ server });

server.listen(PORT, () => {
  console.log("🚀 COACH INTELIGENTE PRO ONLINE");
});

// 🔊 VOZ
const VOICE_ID = "XfNU2rGpBa01ckF309OY";

// 🔑 KEYS
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ELEVEN_KEY = process.env.ELEVEN_KEY;

// 🧠 HELPERS
const normalize = (t) =>
  t.toLowerCase().replace(/[.,!?]/g, "").trim();

// 📦 SESSIONS
const sessions = new Map();

// 🧠 GEMINI SOLO PARA EXPLICAR / CONVERSAR
async function askGemini(state, userText) {
  const prompt = `
Eres una coach de inglés llamada My Team Coach.

IMPORTANTE:
- No controlas el flujo.
- Solo explicas, corriges y conversas.
- Siempre vuelves suavemente al ejercicio.

CONTEXTO:
Modo: ${state.mode}
Palabra actual: ${state.items?.[state.stepIndex] || "ninguna"}

USUARIO:
${userText}

RESPONDE NATURAL, CORTO, EDUCATIVO.
`;

  try {
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
      data?.candidates?.[0]?.content?.parts?.[0]?.text || null
    );
  } catch {
    return null;
  }
}

// 🔊 TTS
async function speak(ws, text) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": ELEVEN_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
      }),
    }
  );

  if (!res.ok) return;

  const audio = await res.arrayBuffer();
  ws.send(
    JSON.stringify({
      audio: Buffer.from(audio).toString("base64"),
    })
  );
}

// 🚀 WS
wss.on("connection", (ws) => {
  console.log("🟢 Frontend conectado");

  const id = Math.random().toString(36).slice(2);

  sessions.set(id, {
    mode: null,
    items: [],
    stepIndex: 0,
  });

  ws.id = id;

  ws.on("message", async (msg) => {
    const data = JSON.parse(msg.toString());
    const state = sessions.get(id);

    if (!state) return;

    // 🧠 START SESSION
    if (data.type === "start_session") {
      state.mode = data.mode;
      state.items = data.items;
      state.stepIndex = 0;

      await speak(
        ws,
        state.mode === "book"
          ? "Vamos a comenzar el libro"
          : "Vamos a practicar frases de la semana"
      );

      return;
    }

    const text = normalize(data.text);
    if (!text || text.length < 2) return;

    const current = normalize(state.items[state.stepIndex]);

    console.log("🎤 Usuario:", text);

    // ✅ SI ES CORRECTO
    if (text.includes(current)) {
      state.stepIndex++;

      if (state.stepIndex >= state.items.length) {
        await speak(
          ws,
          "Well done! See you in the next training"
        );

        ws.close();
        sessions.delete(id);
        return;
      }

      await speak(ws, "Muy bien, siguiente");

      return;
    }

    // 💬 SI NO ES CORRECTO → CONVERSACIÓN NATURAL
    const reply = await askGemini(state, data.text);

    if (reply) {
      await speak(ws, reply);
    } else {
      await speak(
        ws,
        `Intenta otra vez: ${state.items[state.stepIndex]}`
      );
    }
  });

  ws.on("close", () => {
    sessions.delete(id);
    console.log("🔴 Frontend desconectado");
  });
});
