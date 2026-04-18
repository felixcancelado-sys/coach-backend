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

function buildSystemInstruction(topic) {

  let topicInstructions = "";

  if (topic === "Frases de la semana") {

    topicInstructions = `
Trabajas únicamente estas frases:

Good morning
say good bye
Take the pencil
take your implements
go to the bathroom
go to your bedroom
Brush your teeth
wash your hands
Clean up your table
clean up your room
Clean your nose
Comb your hair

Solo estas frases.
No agregas otras.
Antes de cada frase dices:
repeat after me
`;

  }


  if (topic === "Práctica de vocabulario de My Book") {

    topicInstructions = `
Trabajas únicamente estas palabras:

Circle
Square
Triangle
Rectangle

Solo estas palabras.
No agregas otras.
Antes de cada palabra dices:
repeat after me
`;

  }


  return `

Eres la Coach oficial de My Team.

Hablas siempre en español.
Solo usas inglés para modelar pronunciación.

Flujo:

1 saluda
2 pregunta el nombre
3 entrena
4 al terminar di:

"Hemos terminado la sesión."

luego di:

"well done! see you in the next training"

no continúes después de despedirte.

${topicInstructions}

`;
}



server.listen(PORT, () => {
  console.log("🚀 BACKEND READY");
});



wss.on("connection", (ws) => {

  console.log("🟢 CLIENTE CONECTADO");

  let session = null;
  let ready = false;
  let topic = "Frases de la semana";

  let transcript = "";
  let closingDetected = false;



  function normalize(text) {

    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\\u0300-\\u036f]/g, "")
      .replace(/[^a-zA-Z ]/g, "")
      .replace(/\\s+/g, " ");

  }



  function detectClosing(text) {

    const t = normalize(text);

    const signals = [

      "terminado",
      "finalizado",
      "sesion",
      "entrenamiento",
      "training",
      "see you",
      "next training",
      "good job",
      "well done",
      "great job"

    ];

    return signals.some(s => t.includes(s));

  }



  function closeSession() {

    console.log("🏁 CERRANDO SESIÓN");

    ws.send(JSON.stringify({

      type: "sessionEnded"

    }));


    setTimeout(() => {

      try {

        ws.close();

      } catch {}

    }, 800);

  }



  function startSession() {

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

        onopen() {

          console.log("🔗 SESIÓN ABIERTA");

        },



        onmessage(msg) {

          try {

            if (msg.setupComplete) {

              ready = true;

              ws.send(JSON.stringify({

                type: "readyForUser"

              }));


              session.sendRealtimeInput({

                text: "saluda y comienza"

              });

              return;

            }



            const chunk = msg.outputTranscription?.text;

            if (chunk) {

              transcript += " " + chunk;

              console.log("📝", chunk);



              if (detectClosing(transcript)) {

                closingDetected = true;

                console.log("🏁 FRASE DE CIERRE DETECTADA");

              }

            }



            const parts = msg.serverContent?.modelTurn?.parts;

            if (parts) {

              parts.forEach(p => {

                if (p.inlineData?.data) {

                  ws.send(JSON.stringify({

                    type: "audio",
                    audio: p.inlineData.data

                  }));

                }

              });

            }



            if (msg.serverContent?.turnComplete) {

              ws.send(JSON.stringify({

                type: "turnComplete"

              }));


              if (closingDetected) {

                closeSession();

              }

              transcript = "";

            }



          } catch(e) {

            console.log(e);

          }

        },



        onclose() {

          console.log("⚪ GOOGLE CLOSED");

        },



        onerror(e) {

          console.log("🔴 ERROR", e);

        }

      }

    }).then(s => {

      session = s;

    });

  }



  ws.on("message", data => {

    const msg = JSON.parse(data.toString());



    if (msg.type === "startSession") {

      topic = msg.topic;

      startSession();

    }



    if (msg.type === "audio") {

      if (!ready) return;

      session.sendRealtimeInput({

        audio: {

          data: msg.audio,
          mimeType: "audio/pcm;rate=16000"

        }

      });

    }

  });



  ws.on("close", () => {

    console.log("🔴 CLIENT CLOSED");

    try {

      session?.close();

    } catch {}

  });

});
