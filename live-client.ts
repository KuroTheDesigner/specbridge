import { AudioStreamer } from "./audio-streamer";

const HOST = "generativelanguage.googleapis.com";
const URI = `wss://${HOST}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent`;

export class LiveClient {
    ws: WebSocket | null = null;
    audio: AudioStreamer;
    
    constructor(public apiKey: string, public onUpdate: (msg: any) => void) {
        this.audio = new AudioStreamer();
    }

    async connect(systemInstruction: string) {
        const url = `${URI}?key=${this.apiKey}`;
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            console.log("Connected to Gemini Live");
            this.sendSetup(systemInstruction);
            // Start mic immediately after connect
            this.audio.startRecording((b64) => this.sendAudio(b64));
        };

        this.ws.onmessage = async (event) => {
            let data;
            if (event.data instanceof Blob) {
                data = JSON.parse(await event.data.text());
            } else {
                data = JSON.parse(event.data);
            }

            // Handle server audio
            if (data.serverContent?.modelTurn?.parts?.[0]?.inlineData) {
                const audioB64 = data.serverContent.modelTurn.parts[0].inlineData.data;
                this.audio.playChunk(audioB64);
            }
            
            // Pass full message to UI for text/tool handling
            this.onUpdate(data);
        };

        this.ws.onerror = (e) => console.error("WebSocket error", e);
        this.ws.onclose = () => console.log("WebSocket closed");
    }

    sendSetup(systemInstruction: string) {
        const msg = {
            setup: {
                model: "models/gemini-2.0-flash-exp", // Using the flash-exp model which supports Live
                generationConfig: {
                    responseModalities: ["AUDIO"] 
                },
                systemInstruction: {
                    parts: [{ text: systemInstruction }]
                }
            }
        };
        this.ws?.send(JSON.stringify(msg));
    }

    sendAudio(b64: string) {
        const msg = {
            realtimeInput: {
                mediaChunks: [{
                    mimeType: "audio/pcm;rate=24000",
                    data: b64
                }]
            }
        };
        this.ws?.send(JSON.stringify(msg));
    }

    sendText(text: string) {
        const msg = {
            clientContent: {
                turns: [{
                    role: "user",
                    parts: [{ text }]
                }],
                turnComplete: true
            }
        };
        this.ws?.send(JSON.stringify(msg));
    }

    disconnect() {
        this.ws?.close();
        this.audio.stopRecording();
        this.ws;
    }
}
