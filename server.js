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

function fallbackItemsForTopic(topic) {
  if (topic === "Frases de la semana") {
    return ["Good morning"];
  }

  if (topic === "Práctica de vocabulario de My Book") {
    return ["Circle", "Square", "Triangle", "Rectangle"];
  }

  return ["Good morning"];
}

function buildPrompt(topic, items) {
  const safeItems =
    Array.isArray(items) && items.length > 0
      ? items
      : fallbackItemsForTopic(topic);

  const contentList = safeItems.map((item) => `- ${item}`).join("\n");

  return `
Eres la Coach oficial de My Team Bilingual Process.

OBJETIVO:
Entrenar pronunciación en inglés.

REGLAS GENERALES:
- Hablas SIEMPRE en español.
- SOLO usas inglés para pronunciar o modelar la palabra o frase objetivo.
- Das instrucciones en español.
- Das retroalimentación en español.
- Eres cálida, motivadora, positiva y exigente.
- No cambias de tema.
- No agregas palabras o frases fuera de la lista.
- No avances automáticamente sin escuchar al estudiante.
- Si el estudiante pregunta otra cosa, responde: ‘En este training practicamos solo estas palabras’ y vuelve al ítem actual.

MODO DE ENTRENAMIENTO:
- Trabajas UN ítem por vez.
- Antes de cada ítem dices exactamente: "repeat after me".
- Luego pronuncias la palabra o frase en inglés.
- Después te callas y esperas al estudiante.
- Escuchas atentamente el intento del estudiante.

EVALUACIÓN ULTRA ESTRICTA:
- La palabra correcta es EXACTAMENTE la que está en la lista oficial.
- Debes comparar mentalmente lo que escuchaste con esa palabra exacta.
- Solo puedes considerar correcta la pronunciación si coincide claramente con la palabra objetivo.
- Si el estudiante dice otra palabra, inventa sonidos o cambia sílabas importantes, es incorrecto.
- Si hay errores fonéticos evidentes, es incorrecto.
- No seas indulgente.
- No avances por simpatía.
- No felicites si no coincide claramente.
- Si no coincide, di en español que no fue correcta y pide repetir el mismo ítem.
- Solo cuando sea claramente correcta puedes felicitar brevemente en español y continuar.
- Prestar atención a las primeras y las últimas sílabas para decidir si la pronunciación es adecuada.

TEMA ACTUAL:
${topic}

LISTA OFICIAL DE ESTA SESIÓN:
${contentList}

IMPORTANTE (MODO ESTRICTO):
- Debes practicar SOLO esta lista.
- No agregas palabras o frases fuera de la lista.
- Das feedback breve en español (1 frase).
- NO felicites si está mal o si tienes dudas.
- Si tienes dudas, trátalo como incorrecto.
- No tardes tanto en dar feedback.

RESPUESTAS OBLIGATORIAS (usa estas frases exactas):
- Si está MAL: di EXACTAMENTE: "No está correcto. Repite." y vuelve a modelar la MISMA palabra.
- Si está BIEN: di EXACTAMENTE: "Muy bien. Siguiente." y continúa con el siguiente ítem.

CRITERIOS DE PRONUNCIACIÓN (para decidir correcto/incorrecto):
- Presta especialmente atención a la primera y la última sílaba.
- Cuando haya palabras con "R" en inglés NO aceptar si el usuario golpea el paladar. Explica que la "R" en inglés es más sutil.
- No aceptar palabras que usen la "R" como se pronuncia en español.
- Cuando haya palabras con "G" en inglés verifica su pronunciación.
- Cuando haya palabras con "S", sobre todo en sílaba inicial, explicar que la "S" en inglés NO se pronuncia "es".
- Si detectas cualquiera de estos errores, se considera incorrecto y se repite.

CONTROL DE AVANCE:
- Nunca avances automáticamente.
- Antes de cada ítem dices exactamente: "repeat after me". No digas "repite después de mí" en español.
- Luego pronuncias la palabra en inglés.
- Si el estudiante se equivoca, NO avanzas. Repite el mismo ítem.
- Solo avanzas cuando estés segura de que la pronunciación es claramente correcta.

CIERRE:
Cuando termines TODA la lista, debes cerrar SIEMPRE diciendo esta frase exacta al final:
"Well done and see you in the next training"

Esa debe ser tu última frase.
Después no sigues hablando.
`;
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectFinalClosing(text) {
  const normalized = normalizeText(text);

  return (
    normalized.includes("well done and see you in the next training") ||
    normalized.includes("see you in the next training")
  );
}

server.listen(PORT, () => {
  console.log("backend ready");
});

wss.on("connection", (ws) => {
  console.log("🟢 CLIENTE CONECTADO");

  let session = null;
  let ready = false;
  let topic = "Frases de la semana";
  let items = fallbackItemsForTopic(topic);
  let currentIndex = 0; // control de ítem actual

  let transcriptBuffer = "";
  let pendingCloseAfterTurn = false;
  let closeTriggered = false;
  let keepAliveInterval = null;
  let googleClosed = false;
  let initialInstructionSent = false;

  function triggerSessionEnd() {
    if (closeTriggered) return;

    closeTriggered = true;
    pendingCloseAfterTurn = false;

    console.log("🏁 CERRANDO SESIÓN");

    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "sessionEnded" }));
    }

    setTimeout(() => {
      try {
        if (ws.readyState === ws.OPEN) {
          ws.close(1000, "training completed");
        }
      } catch {}
    }, 900);
  }

  function sendInitialInstructionIfReady() {
    if (initialInstructionSent) return;
    if (!ready || !session) return;

    initialInstructionSent = true;

    session.sendRealtimeInput({
      text:
        "Saluda en español, preséntate como la Coach de My Team, pregunta el nombre del estudiante, espera su respuesta y luego empieza a practicar la lista oficial, un ítem por vez, dando feedback en español.",
    });

    console.log("💬 COACH INICIADA");
  }

  function startGeminiSession() {
    console.log("🎯 INICIANDO SESIÓN CON TEMA:", topic);
    console.log("📚 ITEMS:", items);

    ready = false;
    transcriptBuffer = "";
    pendingCloseAfterTurn = false;
    closeTriggered = false;
    googleClosed = false;
    initialInstructionSent = false;

    ai.live
      .connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Kore",
              },
            },
          },
          systemInstruction: {
            parts: [{ text: buildPrompt(topic, items) }],
          },
        },
        callbacks: {
          onopen: () => {
            console.log("🟣 GOOGLE LIVE ABIERTA");
          },

          onmessage: (msg) => {
            try {
              if (msg.setupComplete) {
                ready = true;
                console.log("✅ SETUP COMPLETO");

                if (ws.readyState === ws.OPEN) {
                  ws.send(JSON.stringify({ type: "readyForUser" }));
                }

                sendInitialInstructionIfReady();
                return;
              }

              // ✅ Transcripción del MODELO (output)
              const transcriptChunk = msg.outputTranscription?.text;

              if (typeof transcriptChunk === "string" && transcriptChunk.trim()) {
                const cleanChunk = transcriptChunk.trim();
                transcriptBuffer += " " + cleanChunk;

                console.log("📝 TRANSCRIPCIÓN:", cleanChunk);

                // ✅ Detectar cierre por frase final (backend)
                if (detectFinalClosing(transcriptBuffer)) {
                  pendingCloseAfterTurn = true;
                  console.log("🏁 FRASE FINAL DETECTADA");
                }

                // ✅ Validación "best-effort" (si sigues queriendo usar transcript del modelo)
                // Nota: Esto NO es transcripción del estudiante, es del modelo.
                // Si quieres evaluación del estudiante de verdad, hay que habilitar inputAudioTranscription.
                const studentSaid = normalizeText(cleanChunk);
                const expected = normalizeText(items[currentIndex] || "");

                console.log("👂 (texto) :", studentSaid);
                console.log("🎯 ESPERADO:", expected);

                // Solo como señal: si aparece exactamente la palabra esperada en la transcripción
                if (expected && studentSaid.includes(expected)) {
                  // No incrementamos aquí para no desincronizar. Si lo quieres, lo hacemos en turnComplete.
                }
              }

              // ✅ Audio del modelo → frontend
              const parts = msg.serverContent?.modelTurn?.parts;

              if (parts?.length) {
                for (const p of parts) {
                  if (p.inlineData?.data) {
                    process.stdout.write("🔊");

                    if (ws.readyState === ws.OPEN) {
                      ws.send(
                        JSON.stringify({
                          type: "audio",
                          audio: p.inlineData.data,
                        })
                      );
                    }
                  }
                }
              }

              // ✅ Cierre ordenado al finalizar turno
              if (msg.serverContent?.turnComplete) {
                console.log("\n✅ TURNO COMPLETO");
                console.log("📌 pendingCloseAfterTurn:", pendingCloseAfterTurn);

                if (pendingCloseAfterTurn) {
                  triggerSessionEnd();
                  return;
                }

                transcriptBuffer = "";

                if (ws.readyState === ws.OPEN) {
                  ws.send(JSON.stringify({ type: "turnComplete" }));
                }
              }
            } catch (err) {
              console.error("❌ ERROR MENSAJE:", err);
            }
          },

          onclose: (e) => {
            googleClosed = true;
            console.log(`⚪ GOOGLE CERRÓ: ${e.code}`);

            if (pendingCloseAfterTurn && !closeTriggered) {
              triggerSessionEnd();
              return;
            }

            if (ws.readyState === ws.OPEN) {
              ws.close();
            }
          },

          onerror: (err) => {
            console.error("🔴 ERROR GEMINI:", err);

            if (ws.readyState === ws.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "error gemini",
                })
              );
            }
          },
        },
      })
      .then((s) => {
        session = s;
        console.log("🔗 SESIÓN LISTA");

        // (por si setupComplete tarda)
        sendInitialInstructionIfReady();

        keepAliveInterval = setInterval(() => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, 15000);
      })
      .catch((err) => {
        console.error("❌ ERROR INICIANDO:", err);

        if (ws.readyState === ws.OPEN) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "no se pudo iniciar gemini",
            })
          );
        }
      });
  }

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "startSession") {
        topic = msg.topic || "Frases de la semana";

        items =
          Array.isArray(msg.items) && msg.items.length > 0
            ? msg.items
            : fallbackItemsForTopic(topic);

        currentIndex = 0;

        console.log("📚 TEMA RECIBIDO:", topic);
        console.log("🧾 ITEMS RECIBIDOS:", items);

        startGeminiSession();
        return;
      }

      if (msg.type === "audio") {
        if (!ready || !session) return;
        if (closeTriggered) return;

        session.sendRealtimeInput({
          audio: {
            data: msg.audio,
            mimeType: "audio/pcm;rate=16000",
          },
        });
      }
    } catch (err) {
      console.error("❌ ERROR CLIENT MESSAGE:", err);
    }
  });

  ws.on("close", () => {
    console.log("🔴 CLIENT CLOSED");

    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
    }

    if (session && !googleClosed) {
      try {
        session.close();
      } catch {}
    }

    session = null;
    ready = false;
  });
});
