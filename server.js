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
  console.log("🚀 BACKEND READY - AOEDE ONLINE");
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
          parts: [{ text: "Eres Aoede. Saluda de inmediato en español." }]
        }
      },
      callbacks: {
        onmessage: (msg) => {
          // 📡 RADAR: Si Gemini manda algo, lo registramos
          if (msg.setupComplete) {
            console.log("✅ CONEXIÓN CON GOOGLE COMPLETADA");
            // Ahora que sabemos que está listo, saludamos
            enviarSaludoInicial(session);
          }

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
        onerror: (e) => console.log("🔴 ERROR EN SESIÓN:", e),
        onclose: () => console.log("⚪ SESIÓN CERRADA")
      }
    });

    // Función interna para asegurar que el saludo se envíe bien
    async function enviarSaludoInicial(targetSession) {
      console.log("🗣️ Intentando saludo inicial...");
      try {
        await targetSession.send({
          clientContent: {
            turns: [{ role: "user", parts: [{ text: "Hola Aoede, preséntate brevemente." }] }],
            turnComplete: true
          }
        });
      } catch (e) {
        console.log("⚠️ Falló el envío del saludo, Gemini aún no acepta datos.");
      }
    }

    ws.on("message", async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "audio" && session) {
          let base64 = typeof msg.audio === "string" ? msg.audio : Buffer.from(new Int16Array(msg.audio).buffer).toString("base64");
          await session.send({ 
            realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: base64 }] } 
          });
        }
      } catch (e) {}
    });

    ws.on("close", () => {
      console.log("🔴 CLIENT DISCONNECTED");
      if (session) session.close();
    });

  } catch (err) {
    console.error("❌ ERROR AL INICIAR:", err.message);
  }
});
