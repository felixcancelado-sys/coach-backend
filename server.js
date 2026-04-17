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
  console.log("🚀 BACKEND READY - MODO PACIENTE");
});

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENT CONNECTED");
  let session;

  try {
    session = await ai.live.connect({
      model: "models/gemini-2.5-flash-native-audio-latest", 
      config: {
        responseModalities: ["AUDIO"],
        systemInstruction: {
          parts: [{ text: "Eres Aoede. Responde siempre en español. No cierres la sesión, espera a que el usuario hable." }]
        },
        // Añadimos configuración de voz para evitar el cierre preventivo
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } }
      },
      callbacks: {
        onmessage: (msg) => {
          if (msg.setupComplete) console.log("✅ CONFIGURACIÓN LISTA");
          
          const parts = msg.serverContent?.modelTurn?.parts;
          if (parts) {
            parts.forEach(p => {
              if (p.inlineData?.data) {
                process.stdout.write("🔊"); 
                ws.send(JSON.stringify({ type: "audio", audio: p.inlineData.data }));
              }
            });
          }
        },
        onclose: (e) => console.log(`⚪ GOOGLE CERRÓ: ${e.code}`),
        onerror: (e) => console.log("🔴 ERROR:", e)
      }
    });

    ws.on("message", async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "audio" && session) {
          // Enviamos el audio con el formato exacto
          session.send({ 
            realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: msg.audio }] } 
          });
        }
      } catch (e) {}
    });

    ws.on("close", () => {
      console.log("🔴 CLIENTE SE FUE");
      if (session) session.close();
    });

  } catch (err) {
    console.error("❌ ERROR:", err.message);
  }
});
