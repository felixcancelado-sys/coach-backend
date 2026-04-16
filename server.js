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
          parts: [{ text: "Eres Aoede. Responde siempre en español con voz clara." }]
        }
      },
      callbacks: {
        onmessage: (msg) => {
          // Extraemos el audio de la respuesta de Gemini
          const parts = msg.serverContent?.modelTurn?.parts;
          if (parts) {
            parts.forEach(p => {
              if (p.inlineData?.data) {
                process.stdout.write("🔊"); // 👈 SI VES ESTO EN RAILWAY, AOEDE ESTÁ HABLANDO
                ws.send(JSON.stringify({ type: "audio", audio: p.inlineData.data }));
              }
            });
          }
        },
        onerror: (e) => console.log("🔴 ERROR EN SESIÓN:", e),
        onclose: () => console.log("⚪ SESIÓN CON GOOGLE CERRADA")
      }
    });

    console.log("🧠 MOTOR KORE ACTIVO (Usando Callbacks)");

    // Saludo forzado: Usamos la estructura de turnos que es más robusta
    setTimeout(async () => {
      if (session) {
        console.log("🗣️ Enviando saludo inicial...");
        try {
          await session.send({
            clientContent: {
              turns: [{ role: "user", parts: [{ text: "Hola Aoede, preséntate brevemente en español." }] }],
              turnComplete: true
            }
          });
        } catch (e) {
          console.log("⚠️ No se pudo enviar el saludo inicial");
        }
      }
    }, 2000);

    ws.on("message", async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "audio" && session) {
          let base64 = typeof msg.audio === "string" ? msg.audio : Buffer.from(new Int16Array(msg.audio).buffer).toString("base64");
          
          await session.send({ 
            realtimeInput: { 
              mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: base64 }] 
            } 
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
