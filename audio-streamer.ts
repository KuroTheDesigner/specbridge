/**
 * Handles audio recording and playback for Gemini Live API.
 * - Records at 16kHz (or requested rate) PCM 16-bit.
 * - Plays back PCM 16-bit chunks.
 */
export class AudioStreamer {
    context: AudioContext;
    worklet: AudioWorkletNode | null = null;
    source: MediaStreamAudioSourceNode | null = null;
    isPlaying = false;
    audioQueue: Int16Array[] = [];
    scheduledTime = 0;
    gainNode: GainNode;

    constructor(public sampleRate = 24000) {
        this.context = new AudioContext({ sampleRate });
        this.gainNode = this.context.createGain();
        this.gainNode.connect(this.context.destination);
    }

    async startRecording(onData: (b64: string) => void) {
        await this.context.resume();
        
        // Add recorder worklet
        // Note: In a real app, this worklet code should be in a separate file or blob
        const workletCode = `
        class RecorderProcessor extends AudioWorkletProcessor {
            process(inputs, outputs, parameters) {
                const input = inputs[0];
                if (input.length > 0) {
                    const channel = input[0];
                    this.port.postMessage(channel);
                }
                return true;
            }
        }
        registerProcessor('recorder-processor', RecorderProcessor);
        `;
        const blob = new Blob([workletCode], { type: "application/javascript" });
        await this.context.audioWorklet.addModule(URL.createObjectURL(blob));

        const stream = await navigator.mediaDevices.getUserMedia({ audio: {
            channelCount: 1,
            sampleRate: this.sampleRate,
        }});

        this.source = this.context.createMediaStreamSource(stream);
        this.worklet = new AudioWorkletNode(this.context, 'recorder-processor');

        this.worklet.port.onmessage = (e) => {
            const float32 = e.data;
            const int16 = this.float32ToInt16(float32);
            const b64 = this.arrayBufferToBase64(int16.buffer);
            onData(b64);
        };

        this.source.connect(this.worklet);
        this.worklet.connect(this.context.destination); // Keep alive
    }

    stopRecording() {
        this.source?.disconnect();
        this.worklet?.disconnect();
        this.source = null;
        this.worklet = null;
    }

    playChunk(b64: string) {
        const arrayBuffer = this.base64ToArrayBuffer(b64);
        const int16 = new Int16Array(arrayBuffer);
        const float32 = this.int16ToFloat32(int16);

        const buffer = this.context.createBuffer(1, float32.length, this.sampleRate);
        buffer.copyToChannel(float32, 0);

        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.gainNode);

        // Simple scheduling to prevent overlaps/gaps
        const currentTime = this.context.currentTime;
        if (this.scheduledTime < currentTime) {
            this.scheduledTime = currentTime;
        }
        source.start(this.scheduledTime);
        this.scheduledTime += buffer.duration;
    }

    // --- Helpers ---

    float32ToInt16(float32: Float32Array) {
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
            const s = Math.max(-1, Math.min(1, float32[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return int16;
    }

    int16ToFloat32(int16: Int16Array) {
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
            float32[i] = int16[i] / 32768.0;
        }
        return float32;
    }

    arrayBufferToBase64(buffer: ArrayBuffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    base64ToArrayBuffer(base64: string) {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }
}
