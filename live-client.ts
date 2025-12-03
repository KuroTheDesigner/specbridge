import { AudioStreamer } from "./audio-streamer";

const HOST = "generativelanguage.googleapis.com";
const URI = `wss://${HOST}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent`;

export class LiveClient {
    ws: WebSocket | null = null;
    audio: AudioStreamer;
    private msgQueue: string[] = [];
    
    constructor(public apiKey: string, public onUpdate: (msg: any) => void) {
        this.audio = new AudioStreamer();
    }

    async connect(systemInstruction: string) {
        const url = `${URI}?key=${this.apiKey}`;
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            console.log("Connected to Gemini Live");
            this.sendSetup(systemInstruction);
            
            // Flush queue
            while (this.msgQueue.length > 0) {
                const msg = this.msgQueue.shift();
                if (msg) this.ws?.send(msg);
            }

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
        this.ws.onclose = (event) => {
            console.log(`WebSocket closed: Code=${event.code}, Reason=${event.reason}`);
            let errorMsg = "Connection closed";
            if (event.code === 1011) {
                if (event.reason.includes("quota")) {
                    errorMsg = "Quota exceeded. Please check billing.";
                } else {
                    errorMsg = "Server error: " + event.reason;
                }
            }
            this.onUpdate({ connectionState: "disconnected", error: errorMsg });
        };
    }

    private safeSend(data: any) {
        const msg = JSON.stringify(data);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(msg);
        } else {
            this.msgQueue.push(msg);
        }
    }

    sendSetup(systemInstruction: string) {
        // Setup must be sent immediately on open, so we bypass the queue check inside connect
        // But if we call safeSend it will just work if called from onopen.
        // However, sendSetup is called explicitly in onopen.
        // Let's keep using this.ws.send in sendSetup if called from onopen, 
        // OR just use safeSend but ensure it's called when open.
        
        // Wait, sendSetup is called inside onopen. So it's safe to send directly.
        // But to be consistent let's just build the object and use safeSend? 
        // Actually, sendSetup sends the initial configuration.
        
        const msg = {
            setup: {
                model: "models/gemini-2.0-flash-exp",
                generationConfig: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } }
                    }
                },
                systemInstruction: {
                    parts: [{ text: systemInstruction }]
                },
                tools: [{ functionDeclarations: [
                    {
                        name: "updateSpec",
                        description: "Update the design brief.",
                        parameters: { type: "OBJECT", properties: { content: { type: "STRING" } }, required: ["content"] }
                    },
                    {
                        name: "askFollowUpQuestions",
                        description: "Propose strategic questions.",
                        parameters: { 
                            type: "OBJECT", 
                            properties: { 
                                intro: { type: "STRING" },
                                qs: { type: "ARRAY", items: { type: "STRING" } }
                            }, 
                            required: ["intro", "qs"] 
                        }
                    }
                ]}]
            }
        };
        // If called from onopen, readyState is OPEN.
        this.safeSend(msg);
    }

    sendToolResponse(functionCallId: string, name: string, response: any) {
        this.safeSend({
            toolResponse: {
                functionResponses: [{
                    id: functionCallId,
                    name: name,
                    response: { result: response }
                }]
            }
        });
    }

    sendAudio(b64: string) {
        this.safeSend({
            realtimeInput: {
                mediaChunks: [{
                    mimeType: "audio/pcm;rate=24000",
                    data: b64
                }]
            }
        });
    }

    sendText(text: string) {
        this.safeSend({
            clientContent: {
                turns: [{
                    role: "user",
                    parts: [{ text }]
                }],
                turnComplete: true
            }
        });
    }

    disconnect() {
        this.ws?.close();
        this.audio.stopRecording();
        this.ws = null;
        this.msgQueue = [];
    }
}
