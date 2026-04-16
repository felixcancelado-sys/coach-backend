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

wss.on("connection", async (ws) => {
  console.log("🟢 CLIENT CONNECTED");

  let session;
  let audioMicRecibido = false;

  try {
    session = await ai.live.connect({
      model: "gemini-2.5-flash-native-audio-preview-12-2025", 
      config: {
        responseModalities: ["AUDIO"],
        systemInstruction: {
          parts: [{ text: "Eres una coach de inglés. Sé muy breve y amable." }]
        }
      },
      callbacks: {
        onmessage: (msg) => {
          // 📡 RADAR 1: Ver si Gemini nos está respondiendo
          if (msg.serverContent?.modelTurn?.parts) {
            process.stdout.write("🔊"); // Imprime un ícono por cada pedacito de audio que manda Gemini
            
            const parts = msg.serverContent.modelTurn.parts;
            for (const part of parts) {
              if (part.inlineData?.data) {
                ws.send(JSON.stringify({ type: "audio", audio: part.inlineData.data }));
              }
            }
          } else if (msg.turnComplete) {
            console.log("\n✅ GEMINI TERMINÓ DE HABLAR");
          }
        },
        onerror: (err) => console.error("🔴 ERROR DE GEMINI:", err),
        onclose: (e) => console.log(`🔴 STREAM CERRADO POR GEMINI: ${e.code}`)
      }
    });

    console.log("🧠 MOTOR KORE DESPIERTO Y ESCUCHANDO (Canal v1alpha)");

    // Saludo inicial forzado
    setTimeout(async () => {
      console.log("🗣️ Forzando saludo inicial...");
      try {
        if (typeof session.send === 'function') {
          await session.send({
            clientContent: { turns: [{ role: "user", parts: [{ text: "Hola Aoede, di 'Hola, te escucho' en español." }] }], turnComplete: true }
          });
        }
      } catch (err) {
        console.error("⚠️ Error en el saludo:", err.message);
      }
    }, 2000); 

    ws.on("message", async (data) => {
      if (!session) return;
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "audio" && typeof msg.audio === "string") {
          // 📡 RADAR 2: Confirmar que tu voz llega al servidor
          if (!audioMicRecibido) {
            console.log("🎤 AUDIO DEL MICRÓFONO RECIBIÉNDOSE PERFECTAMENTE");
            audioMicRecibido = true;
          }

          if (typeof session.send === 'function') {
            await session.send({
              realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: msg.audio }] }
            });
          }
        }
      } catch (err) {
        console.error("⚠️ Error procesando micrófono:", err.message);
      }
    });

    ws.on("close", () => {
      console.log("🔴 CLIENT DISCONNECTED (El usuario cerró o recargó la página)");
      session = null;
    });

  } catch (err) {
    console.error("❌ ERROR CRÍTICO AL CONECTAR:", err.message);
  }
});
