import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { LiveClient } from "./live-client";
import ReactMarkdown from "react-markdown";
import { motion, AnimatePresence } from "framer-motion";

/**
 * ============================================================================
 * CONFIG & PROMPTS
 * ============================================================================
 */
const API_KEY = process.env.API_KEY || "";

const PM_SYSTEM = `
You are a visionary Design Partner. Your goal is to extract a bold, clear vision from the user for their software idea.
Protocol:
1. Listen intently.
2. If the user's idea is vague, ask 1 provocative question at a time.
3. If the idea is solid, compliment it.
4. Keep spoken responses short, punchy, and inspiring. Avoid corporate jargon.
`;

/**
 * ============================================================================
 * HOOKS (LOGIC LAYER)
 * ============================================================================
 */
function useSpecAgent() {
    const [history, setHistory] = useState<{role:string, text:string}[]>([]);
    const [spec, setSpec] = useState("# Untitled Vision\n\nWaiting for input...");
    const [status, setStatus] = useState<"idle"|"listening"|"speaking">("idle");
    
    const clientRef = useRef<LiveClient | null>(null);

    const connect = () => {
        if (clientRef.current) return;
        
        const client = new LiveClient(API_KEY, (msg) => {
            // Handle model updates
            if (msg.serverContent?.turnComplete) {
                setStatus("listening"); // Back to listening after turn
            }
            
            // Simple transcription handling (if enabled in responseModalities, currently AUDIO only)
            // Future: Add text transcription handling if we enable TEXT modality
        });
        
        client.connect(PM_SYSTEM);
        clientRef.current = client;
        setStatus("listening");
    };

    const disconnect = () => {
        clientRef.current?.disconnect();
        clientRef.current = null;
        setStatus("idle");
    };

    return {
        spec, status,
        toggle: () => status === "idle" ? connect() : disconnect()
    };
}

/**
 * ============================================================================
 * UI COMPONENTS (VIEW LAYER)
 * ============================================================================
 */

// --- Icons ---
const Icons = {
    Mic: ({active}: {active?:boolean}) => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" stroke={active ? "#FF3300" : "currentColor"} />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke={active ? "#FF3300" : "currentColor"} />
            <line x1="12" y1="19" x2="12" y2="22" stroke={active ? "#FF3300" : "currentColor"} />
        </svg>
    )
};

// --- Main App ---
function App() {
    const { spec, status, toggle } = useSpecAgent();
    const [view, setView] = useState<"chat"|"spec">("chat");

    return (
        <div className="stage">
            <div className="oracle-container">
                <h1 className="hero-text">
                    {status === "idle" ? "Tap to Start\nVision Mode" : "Listening..."}
                </h1>
                <button 
                    className={`trigger-zone ${status !== "idle" ? "active" : ""}`}
                    onClick={toggle}
                >
                    <Icons.Mic active={status !== "idle"} />
                </button>
            </div>
            
            <style>{`
                .stage {
                    width: 100vw; height: 100dvh;
                    display: flex; flex-direction: column;
                    justify-content: center; align-items: center;
                    background: #050505; color: white;
                    font-family: sans-serif;
                }
                .hero-text {
                    font-size: 3rem; text-align: center; margin-bottom: 40px;
                    white-space: pre-line;
                }
                .trigger-zone {
                    width: 80px; height: 80px; border-radius: 50%;
                    background: #222; border: none; color: white;
                    cursor: pointer; transition: 0.3s;
                    display: flex; align-items: center; justify-content: center;
                }
                .trigger-zone.active {
                    background: #FF3300; color: black;
                    box-shadow: 0 0 30px rgba(255, 51, 0, 0.4);
                }
            `}</style>
        </div>
    );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);