import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI } from "@google/genai";

const PORT = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocketServer({ server });

// Mantenemos el canal v1alpha, que es obligatorio para el audio en tiempo real
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
      // 🔥 EL MODELO OFICIAL Y GRADUADO
      model: "gemini-2.0-flash", 
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
              if (part.inlineData?.data) {
                process.stdout.write("🔊"); // Radar de voz de Aoede
                ws.send(JSON.stringify({ type: "audio", audio: part.inlineData.data }));
              } 
              else if (part.text) {
                console.log("\n📝 GEMINI ESCRIBIÓ:", part.text);
              }
            }
          }
        },
        onerror: (err) => console.error("🔴 ERROR DE GEMINI:", err),
        onclose: (e) => {
          // Si nos vuelve a cerrar, esta vez nos dirá EXACTAMENTE por qué
          console.log(`🔴 STREAM CERRADO POR GEMINI. Código: ${e.code}, Razón: ${e.reason || "Desconocida"}`);
        }
      }
    });

    console.log("🧠 MOTOR KORE DESPIERTO Y ESCUCHANDO (Canal v1alpha)");

    // Saludo forzado simplificado (Solo texto nativo)
    setTimeout(async () => {
      console.log("🗣️ Forzando saludo inicial de Aoede...");
      if (session && typeof session.send === 'function') {
        try {
          await session.send({
            clientContent: { 
              turns: [{ role: "user", parts: [{ text: "Hola Aoede, preséntate brevemente en español y dime que me escuchas." }] }],
              turnComplete: true 
            }
          });
        } catch (err) {
          console.error("⚠️ Error en el saludo:", err.message);
        }
      }
    }, 2000); 

    ws.on("message", async (data) => {
      if (!session) return;
      try {
        const msg = JSON.parse(data.toString());
        let base64Audio = null;

        if (msg.type === "audio" && Array.isArray(msg.audio)) {
          const pcm16 = new Int16Array(msg.audio.length);
          for (let i = 0; i < msg.audio.length; i++) {
            const v = Math.max(-1, Math.min(1, msg.audio[i]));
            pcm16[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
          }
          base64Audio = Buffer.from(pcm16.buffer).toString("base64");
        } else if (msg.type === "audio" && typeof msg.audio === "string") {
          base64Audio = msg.audio;
        }

        if (base64Audio) {
          if (!audioMicRecibido) {
            console.log("\n🎤 AUDIO DEL MICRÓFONO RECIBIÉNDOSE Y ENVIANDO A GEMINI");
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
      console.log("🔴 CLIENT DISCONNECTED (Pestaña cerrada o recargada)");
      session = null;
    });

  } catch (err) {
    console.error("❌ ERROR CRÍTICO AL CONECTAR:", err.message);
  }
});
