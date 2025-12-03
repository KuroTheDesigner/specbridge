import WebSocket from 'ws';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env manually since we are not using dotenv package runtime config here directly usually
const envConfig = dotenv.parse(fs.readFileSync(path.resolve(__dirname, '../.env')));
const API_KEY = envConfig.GEMINI_API_KEY;

const HOST = "generativelanguage.googleapis.com";
const URI = `wss://${HOST}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent`;
const url = `${URI}?key=${API_KEY}`;

console.log(`Connecting to: ${URI}`);

const ws = new WebSocket(url);

ws.on('open', function open() {
  console.log('Connected!');
  
  const setupMsg = {
    setup: {
        model: "models/gemini-2.0-flash-exp",
        generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } }
            }
        },
        systemInstruction: {
            parts: [{ text: "You are a helpful assistant." }]
        },
        tools: [{ functionDeclarations: [
            {
                name: "updateSpec",
                description: "Update the design brief.",
                parameters: { type: "OBJECT", properties: { content: { type: "STRING" } }, required: ["content"] }
            }
        ]}]
    }
  };

  console.log('Sending setup message...');
  ws.send(JSON.stringify(setupMsg));
});

ws.on('message', function incoming(data) {
  console.log('Received message:', data.toString());
});

ws.on('close', function close(code, reason) {
  console.log(`Disconnected. Code: ${code}, Reason: ${reason.toString()}`);
});

ws.on('error', function error(err) {
  console.error('WebSocket Error:', err);
});
