import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality } from "@google/genai";

const PORT = process.env.PORT || 8080;

const server = http.createServer();
const wss = new WebSocketServer({ server });

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { apiVersion: "v1beta" },
});

Práctica de vocabulario de My Book

  return `

Eres una Coach experta de My Team Bilingual Process.

OBJETIVO:
Entrenar pronunciación en inglés.

REGLAS:

Hablas SIEMPRE en español.
Usas inglés solo para modelar pronunciación.
Eres positiva.
Eres cálida.
Eres motivadora.
No das opciones.
No cambias de tema.

FLUJO:

1. Saludas con entusiasmo
2. Te presentas como Coach My Team
3. Preguntas el nombre del estudiante
4. Usas Bienvenido o Bienvenida según corresponda
5. Comienzas inmediatamente el entrenamiento

${topicInstructions}


CIERRE:

Cuando termines el entrenamiento:

di exactamente:

"Hemos terminado la sesión."

luego di:

"well done! and See you in the next training"

despídete con energía positiva.
`;
}



server.listen(PORT, () => {
  console.log(`🚀 BACKEND READY en puerto ${PORT}`);
});



wss.on("connection", (ws) => {

  console.log("🟢 CLIENTE CONECTADO");

  let session = null;
  let topic = "Frases de la semana";

  let ready = false;
  let googleClosed = false;

  let transcriptBuffer = "";

  let pendingCloseAfterTurn = false;
  let closeTriggered = false;

  let keepAliveInterval = null;



  function triggerSessionEnd() {

    if (closeTriggered) return;

    closeTriggered = true;

    console.log("🏁 CIERRE AUTOMÁTICO DE SESIÓN");

    if (ws.readyState === ws.OPEN) {

      ws.send(JSON.stringify({
        type: "sessionEnded"
      }));

    }

    setTimeout(() => {

      try {

        if (ws.readyState === ws.OPEN) {

          ws.close(1000, "training completed");

        }

      } catch {}

    }, 500);

  }



  function startGeminiSession() {

    console.log("🎯 INICIANDO SESIÓN CON TEMA:", topic);

    ai.live.connect({

      model: "gemini-3.1-flash-live-preview",

      config: {

        responseModalities: [Modality.AUDIO],

        outputAudioTranscription: {},

        speechConfig: {

          voiceConfig: {

            prebuiltVoiceConfig: {

              voiceName: "Kore"

            }

          }

        },

        systemInstruction: {

          parts: [{

            text: buildSystemInstruction(topic)

          }]

        }

      },



      callbacks: {



        onopen: () => {

          console.log("🟣 GOOGLE LIVE ABIERTA");

        },



        onmessage: (msg) => {

          try {

            if (msg.setupComplete) {

              console.log("✅ SETUP COMPLETO");

              ready = true;

              if (ws.readyState === ws.OPEN) {

                ws.send(JSON.stringify({
                  type: "readyForUser"
                }));

              }

              session.sendRealtimeInput({

                text:
                  "Preséntate como coach My Team Bilingual Process, pregunta el nombre del estudiante, espera su respuesta, y comienza el entrenamiento."

              });

              console.log("💬 COACH INICIADA");

              return;

            }



            // transcripción del audio de la coach

            const transcriptChunk = msg.outputTranscription?.text;



            if (typeof transcriptChunk === "string" && transcriptChunk.trim()) {

              const cleanChunk = transcriptChunk.trim();

              transcriptBuffer += " " + cleanChunk;



              const normalized = transcriptBuffer
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "");



              console.log("📝 TRANSCRIPCIÓN:", cleanChunk);

              console.log("🧠 BUFFER:", normalized);



              const closingSignals = [

                "hemos terminado la sesion",
                "terminado la sesion",
                "see you in the next training",
                "well done"

              ];



              const closingDetected = closingSignals.some(signal =>
                normalized.includes(signal)
              );



              if (closingDetected) {

                console.log("🏁 DESPEDIDA DETECTADA");

                pendingCloseAfterTurn = true;

              }

            }



            const parts = msg.serverContent?.modelTurn?.parts;



            if (parts?.length) {

              for (const p of parts) {

                if (p.inlineData?.data) {

                  process.stdout.write("🔊");

                  if (ws.readyState === ws.OPEN) {

                    ws.send(JSON.stringify({

                      type: "audio",
                      audio: p.inlineData.data

                    }));

                  }

                }

              }

            }



            if (msg.serverContent?.turnComplete) {

              console.log("\n✅ TURNO COMPLETO");

              if (ws.readyState === ws.OPEN) {

                ws.send(JSON.stringify({

                  type: "turnComplete"

                }));

              }



              if (pendingCloseAfterTurn) {

                pendingCloseAfterTurn = false;

                setTimeout(() => {

                  triggerSessionEnd();

                }, 900);

              }



              transcriptBuffer = "";

            }



          } catch (err) {

            console.error("❌ ERROR MENSAJE:", err);

          }

        },



        onclose: (e) => {

          googleClosed = true;

          console.log(`⚪ GOOGLE CERRÓ: ${e.code}`);

          if (ws.readyState === ws.OPEN) {

            ws.close();

          }

        },



        onerror: (err) => {

          console.error("🔴 ERROR GEMINI:", err);

          if (ws.readyState === ws.OPEN) {

            ws.send(JSON.stringify({

              type: "error",
              message: "error gemini"

            }));

          }

        }

      }

    })

    .then(s => {

      session = s;

      console.log("🔗 SESIÓN LISTA");



      keepAliveInterval = setInterval(() => {

        if (ws.readyState === ws.OPEN) {

          ws.send(JSON.stringify({

            type: "ping"

          }));

        }

      }, 15000);

    })

    .catch(err => {

      console.error("❌ ERROR INICIANDO:", err);

    });

  }



  ws.on("message", data => {

    try {

      const msg = JSON.parse(data.toString());



      if (msg.type === "startSession") {

        topic = msg.topic;

        console.log("📚 TEMA RECIBIDO:", topic);

        startGeminiSession();

        return;

      }



      if (msg.type === "audio") {

        if (!session || !ready) return;



        session.sendRealtimeInput({

          audio: {

            data: msg.audio,

            mimeType: "audio/pcm;rate=16000"

          }

        });

      }



    } catch (err) {

      console.error("❌ ERROR CLIENT MESSAGE:", err);

    }

  });



  ws.on("close", () => {

    console.log("🔴 CLIENTE DESCONECTADO");



    if (keepAliveInterval) {

      clearInterval(keepAliveInterval);

      keepAliveInterval = null;

    }



    if (session && !googleClosed) {

      try {

        session.close();

      } catch {}

    }

  });

});
