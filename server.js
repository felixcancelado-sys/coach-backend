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
          parts: [{ text: "Eres una coach de inglés amable llamada Aoede. Responde siempre en español." }]
        }
      },
      callbacks: {
        onmessage: (msg) => {
          if (msg.serverContent?.modelTurn?.parts) {
            const parts = msg.serverContent.modelTurn.parts;
            for (const part of parts) {
              // Si responde con Audio
              if (part.inlineData?.data) {
                process.stdout.write("🔊"); 
                ws.send(JSON.stringify({ type: "audio", audio: part.inlineData.data }));
              } 
              // Si responde con Texto (Radar)
              else if (part.text) {
                console.log("\n📝 GEMINI ESCRIBIÓ:", part.text);
              }
            }
          } else if (msg.serverContent?.interrupted) {
            console.log("\n⚠️ GEMINI FUE INTERRUMPIDO POR TU VOZ");
          }
        },
        onerror: (err) => console.error("🔴 ERROR DE GEMINI:", err),
        onclose: (e) => console.log(`🔴 STREAM CERRADO POR GEMINI.`)
      }
    });

    console.log("🧠 MOTOR KORE DESPIERTO Y ESCUCHANDO (Canal v1alpha)");

    // 💥 SALUDO FORZADO (Texto simple, a prueba de fallos)
    setTimeout(async () => {
      console.log("🗣️ Forzando saludo inicial de Aoede...");
      try {
        if (typeof session.send === 'function') {
          await session.send("Hola Aoede, preséntate brevemente en español y dime que me escuchas.");
        }
      } catch (err) {
        console.error("⚠️ Error en el saludo:", err.message);
      }
    }, 2000); 

    ws.on("message", async (data) => {
      if (!session) return;
      try {
        const msg = JSON.parse(data.toString());
        let base64Audio = null;

        // 🛡️ ADAPTADOR UNIVERSAL DE FRONTEND
        if (msg.type === "audio" && Array.isArray(msg.audio)) {
          // Frontend Viejo (Cloudflare cacheado)
          const pcm16 = new Int16Array(msg.audio.length);
          for (let i = 0; i < msg.audio.length; i++) {
            const v = Math.max(-1, Math.min(1, msg.audio[i]));
            pcm16[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
          }
          base64Audio = Buffer.from(pcm16.buffer).toString("base64");
        } else if (msg.type === "audio" && typeof msg.audio === "string") {
          // Frontend Nuevo
          base64Audio = msg.audio;
        }

        // Si tenemos audio, se lo mandamos a Gemini
        if (base64Audio) {
          if (!audioMicRecibido) {
            console.log("\n🎤 AUDIO DEL MICRÓFONO RECIBIÉNDOSE PERFECTAMENTE");
            audioMicRecibido = true;
          }

          if (typeof session.send === 'function') {
            await session.send({
              realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: base64Audio }] }
            });
          }
        }
      } catch (err) {}
    });

    ws.on("close", () => {
      console.log("🔴 CLIENT DISCONNECTED");
      session = null;
    });

  } catch (err) {
    console.error("❌ ERROR CRÍTICO AL CONECTAR:", err.message);
  }
});
