// ... (mantenemos las importaciones)
wss.on("connection", async (ws, req) => {
  // 🔍 RADAR NUEVO: Ver desde dónde viene la conexión
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`🟢 CLIENT CONNECTED desde IP: ${ip}`);

  let session;
  
  // Latido cada 10 segundos para que el Firewall no piense que estamos inactivos
  const heartBeat = setInterval(() => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: "heartbeat" }));
  }, 10000);

  try {
    session = await ai.live.connect({
      model: "models/gemini-2.5-flash-native-audio-latest", 
      config: {
        responseModalities: ["AUDIO"],
        systemInstruction: { parts: [{ text: "Eres Aoede. Responde siempre en español." }] }
      },
      callbacks: {
        onmessage: (msg) => {
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
        onclose: () => console.log("⚪ GEMINI CERRÓ SESIÓN")
      }
    });

    console.log("✅ GEMINI LISTO");

    ws.on("message", async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "audio" && session) {
          await session.send({ 
            realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: msg.audio }] } 
          });
        }
      } catch (e) {}
    });

    ws.on("close", () => {
      clearInterval(heartBeat);
      console.log("🔴 CLIENT DISCONNECTED");
      if (session) session.close();
    });

  } catch (err) {
    console.error("❌ ERROR:", err.message);
  }
});
