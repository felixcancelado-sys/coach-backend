import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI } from "@google/genai";

const PORT = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocketServer({ server });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

server.listen(PORT, () => {
  console.log("🚀 BACKEND READY ON PORT", PORT);
});

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENT CONNECTED");

  let session;

  try {
    // 1. LA CONFIGURACIÓN ESTRICTA QUE EXIGE GEMINI 2.0
    session = await ai.live.connect({
      model: "gemini-2.0-flash-exp",
      config: {
        // CORRECCIÓN CLAVE: El audio va dentro de generationConfig
        generationConfig: {
          responseModalities: ["AUDIO"],
        },
        systemInstruction: {
          parts: [{ text: "Eres una coach de inglés amable llamada Aoede. Hablas español y ayudas con la pronunciación." }]
        }
      }
    });

    console.log("🧠 MOTOR KORE DESPIERTO Y ESCUCHANDO");

    // 2. Bucle oficial para escuchar a Gemini
    (async () => {
      try {
        for await (const msg of session.receive()) {
          const parts = msg.serverContent?.modelTurn?.parts;
          if (!parts) continue;

          for (const part of parts) {
            if (part.inlineData?.data) {
              ws.send(JSON.stringify({
                type: "audio",
                audio: part.inlineData.data,
              }));
            }
          }
        }
      } catch (e) {
        console.log("🔴 Stream de Gemini cerrado o interrumpido");
      }
    })();

    // 3. Recibir audio del Frontend y enviarlo a Gemini
    ws.on("message", async (data) => {
      if (!session) return;
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "audio" && Array.isArray(msg.audio)) {
          const pcm16 = new Int16Array(msg.audio.length);
          for (let i = 0; i < msg.audio.length; i++) {
            const v = Math.max(-1, Math.min(1, msg.audio[i]));
            pcm16[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
          }

          const base64Audio = Buffer.from(pcm16.buffer).toString("base64");

          // SINTAXIS OFICIAL DEL NUEVO SDK PARA ENVIAR AUDIO
          await session.send({
            realtimeInput: {
              mediaChunks: [{
                mimeType: "audio/pcm;rate=16000",
                data: base64Audio
              }]
            }
          });
        }

        if (msg.type === "text") {
          // SINTAXIS OFICIAL PARA ENVIAR TEXTO
          await session.send({ text: msg.text });
        }
      } catch (err) {
        console.error("⚠️ Error procesando mensaje de Félix:", err.message);
      }
    });

    ws.on("close", () => {
      console.log("🔴 CLIENT DISCONNECTED");
      session = null;
    });

  } catch (err) {
    console.error("❌ ERROR CRÍTICO:", err.message);
  }
});
