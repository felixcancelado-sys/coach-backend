import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI } from "@google/genai";

const PORT = process.env.PORT || 8080;
const server = http.createServer();
const wss = new WebSocketServer({ server });

// 🔥 LA CLAVE: Obligamos a la librería a usar el canal v1alpha
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

  try {
    session = await ai.live.connect({
      // 🚀 EL MODELO DEFINITIVO PARA AUDIO NATIVO
      model: "gemini-2.5-flash-native-audio-preview-12-2025", 
      config: {
        responseModalities: ["AUDIO"],
        systemInstruction: {
          parts: [{ text: "Eres una coach de inglés amable llamada Aoede. Hablas español y ayudas con la pronunciación." }]
        }
      },
      callbacks: {
        onmessage: (msg) => {
          const parts = msg.serverContent?.modelTurn?.parts;
          if (!parts) return;

          for (const part of parts) {
            if (part.inlineData?.data) {
              ws.send(JSON.stringify({
                type: "audio",
                audio: part.inlineData.data,
              }));
            }
          }
        },
        onerror: (err) => {
          console.error("🔴 ERROR DE GEMINI:", err);
        },
        onclose: (e) => {
          console.log(`🔴 STREAM CERRADO POR GEMINI. Código: ${e.code}`);
        }
      }
    });

    console.log("🧠 MOTOR KORE DESPIERTO Y ESCUCHANDO (Canal v1alpha)");

    // 🛡️ ENVIADOR UNIVERSAL: Prueba todos los métodos posibles
    const sendDataToGemini = async (newFormat, oldFormatArray) => {
      if (typeof session.send === 'function') {
        await session.send(newFormat);
      } else if (typeof session.sendRealtimeInput === 'function') {
        await session.sendRealtimeInput(oldFormatArray);
      } else if (session.ws && typeof session.ws.send === 'function') {
        session.ws.send(JSON.stringify(newFormat));
      } else {
        console.log("🚨 MÉTODOS DISPONIBLES EN SESSION:", Object.getOwnPropertyNames(Object.getPrototypeOf(session)));
      }
    };

    // 💥 SALUDO INICIAL FORZADO
    setTimeout(async () => {
      console.log("🗣️ Forzando saludo inicial de Aoede...");
      try {
        await sendDataToGemini(
          { clientContent: { turns: [{ role: "user", parts: [{ text: "Hola Aoede, preséntate en español y dime que me escuchas." }] }], turnComplete: true } }, 
          [{ text: "Hola Aoede, preséntate en español y dime que me escuchas." }]
        );
      } catch (err) {
        console.error("⚠️ Error en el saludo:", err.message);
      }
    }, 2000); 

    // 🎙️ PROCESAR AUDIO DEL MICRÓFONO
    ws.on("message", async (data) => {
      if (!session) return;
      try {
        const msg = JSON.parse(data.toString());

        // 🔥 AHORA RECIBE BASE64 DIRECTAMENTE (Sin crashear la memoria)
        if (msg.type === "audio" && typeof msg.audio === "string") {
          await sendDataToGemini(
            { realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: msg.audio }] } },
            [{ media: { mimeType: "audio/pcm;rate=16000", data: msg.audio } }]
          );
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
