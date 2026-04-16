import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI } from "@google/genai";

const PORT = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocketServer({ server });

const ai = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { apiVersion: 'v1alpha' } 
});

server.listen(PORT, () => {
  console.log("🚀 BACKEND READY ON PORT", PORT);
});

// Función para listar modelos si algo falla
async function listAvailableModels() {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1alpha/models?key=${process.env.GEMINI_API_KEY}`);
    const data = await response.json();
    console.log("📋 MODELOS DISPONIBLES EN TU CUENTA:");
    data.models.forEach(m => {
      if(m.supportedGenerationMethods.includes("bidiGenerateContent")) {
        console.log(`✅ ${m.name} (SOPORTA AUDIO LIVE)`);
      } else {
        console.log(`⚪ ${m.name}`);
      }
    });
  } catch (err) {
    console.log("No se pudo obtener la lista de modelos.");
  }
}

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENT CONNECTED");

  try {
    const session = await ai.live.connect({
      // 🔥 PRUEBA 1: El nombre más estándar para v1alpha
      model: "gemini-2.5-flash-native-audio-latest", 
      config: {
        responseModalities: ["AUDIO"],
        systemInstruction: {
          parts: [{ text: "Eres Aoede, una coach de inglés amable." }]
        }
      },
      callbacks: {
        onmessage: (msg) => {
          if (msg.serverContent?.modelTurn?.parts) {
            msg.serverContent.modelTurn.parts.forEach(p => {
              if (p.inlineData?.data) {
                process.stdout.write("🔊");
                ws.send(JSON.stringify({ type: "audio", audio: p.inlineData.data }));
              }
            });
          }
        },
        onerror: (err) => console.error("🔴 ERROR:", err),
        onclose: (e) => {
          console.log(`🔴 CERRADO. Código: ${e.code}, Razón: ${e.reason}`);
          if (e.code === 1008) {
             console.log("Buscando el modelo correcto para ti...");
             listAvailableModels();
          }
        }
      }
    });

    console.log("🧠 CONECTADO A GEMINI LIVE");

    ws.on("message", async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "audio" && session) {
          let base64 = typeof msg.audio === "string" ? msg.audio : Buffer.from(new Int16Array(msg.audio).buffer).toString("base64");
          await session.send({ realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: base64 }] } });
        }
      } catch (err) {}
    });

    ws.on("close", () => { session?.close(); });

  } catch (err) {
    console.error("❌ ERROR CRÍTICO:", err.message);
    listAvailableModels();
  }
});
