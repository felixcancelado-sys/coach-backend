import express from "express";
import cors from "cors";
import { GoogleGenAI } from "@google/genai";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

// 🔐 API KEY OCULTA (Railway ENV VAR)
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// 🚀 HEALTH CHECK
app.get("/", (req, res) => {
  res.send("🟢 Gemini Live Secure Backend Running");
});

// 🎤 START LIVE SESSION
app.post("/live/start", async (req, res) => {
  try {
    const { topic } = req.body;

    if (!topic) {
      return res.status(400).json({ error: "Missing topic" });
    }

    const session = await ai.live.connect({
      model: "gemini-2.5-flash-native-audio-preview",

      config: {
        responseModalities: ["AUDIO"],

        systemInstruction: `
Eres una coach de inglés llamada My Team.

Reglas:
- Habla en español
- Usa inglés solo para modelar palabras
- Sé natural, educativa y motivadora

Tema actual: ${topic}

Si el usuario pregunta algo, responde y vuelve al ejercicio.
        `,
      },
    });

    // ⚠️ IMPORTANTE:
    // No enviamos el stream completo aquí (se maneja en frontend o gateway real)
    // Solo devolvemos confirmación

    res.json({
      ok: true,
      message: "Live session ready",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to start session" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Backend Live Seguro corriendo en puerto ${PORT}`);
});
