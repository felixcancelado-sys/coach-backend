import http from "http";
import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality } from "@google/genai";

const PORT = process.env.PORT || 8080;

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

const server = http.createServer();
const wss = new WebSocketServer({ server });

server.listen(PORT, () => {
  console.log("backend ready");
});


function buildPrompt(topic, items){

return `

Eres la Coach oficial de My Team.

Tu tarea es entrenar pronunciación.

Reglas:

Siempre dices:
repeat after me

Luego dices la palabra.

Luego esperas al estudiante.

No avanzas hasta que el estudiante intente.

Das feedback breve.

Trabajas SOLO esta lista:

${items.join("\n")}

Cuando termines TODA la lista debes decir EXACTAMENTE:

see you in the next training

Esa debe ser tu última frase.

`;

}


wss.on("connection", ws=>{

let session=null;
let ready=false;

ws.on("message", async raw=>{

const msg = JSON.parse(raw);

if(msg.type==="startSession"){

const topic=msg.topic;
const items=msg.items;

session = await ai.live.connect({

model:"gemini-3.1-flash-live-preview",

config:{
responseModalities:[Modality.AUDIO],
speechConfig:{
voiceConfig:{
prebuiltVoiceConfig:{ voiceName:"Kore"}
}
},
systemInstruction:{
parts:[{
text: buildPrompt(topic,items)
}]
}
},

callbacks:{

onmessage(ev){

const parts = ev.serverContent?.modelTurn?.parts;

if(parts){

parts.forEach(p=>{

if(p.inlineData?.data){

ws.send(JSON.stringify({
type:"audio",
audio:p.inlineData.data
}));

}

});

}

if(ev.serverContent?.turnComplete){

ws.send(JSON.stringify({
type:"turnComplete"
}));

}

}

}

});

ready=true;

session.sendRealtimeInput({
text:"saluda y comienza"
});

}


if(msg.type==="audio" && ready){

session.sendRealtimeInput({

audio:{
data:msg.audio,
mimeType:"audio/pcm;rate=16000"
}

});

}

});

});
