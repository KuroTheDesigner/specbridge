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
    const [questions, setQuestions] = useState<{id:string, text:string, answered:boolean}[]>([]);
    const [status, setStatus] = useState<"idle"|"listening"|"speaking">("idle");
    const [isDevGen, setIsDevGen] = useState(false);
    
    const clientRef = useRef<LiveClient | null>(null);

    const connect = () => {
        if (clientRef.current) return;
        
        const client = new LiveClient(API_KEY, (msg) => {
            // Handle turn completion
            if (msg.serverContent?.turnComplete) {
                setStatus("listening");
            }

            // Handle tool calls
            if (msg.toolCall) {
                const calls = msg.toolCall.functionCalls;
                if (calls) {
                    calls.forEach((call: any) => {
                        if (call.name === "updateSpec") {
                            setSpec(call.args.content);
                            client.sendToolResponse(call.id, "updateSpec", { success: true });
                        } else if (call.name === "askFollowUpQuestions") {
                            const newQs = (call.args.qs as string[]).map(t => ({
                                id: Math.random().toString(36).slice(2), text: t, answered: false
                            }));
                            setQuestions(newQs);
                            client.sendToolResponse(call.id, "askFollowUpQuestions", { success: true });
                        }
                    });
                }
            }
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

    const generateDevSpec = async () => {
        setIsDevGen(true);
        // Placeholder for dev spec generation (could use REST API or LiveClient text turn)
        // For now, we just simulate it or you could wire up a separate REST call if needed
        // Since we are in Live mode, we might want to just use the current spec content.
        setIsDevGen(false);
        return spec; 
    };

    return {
        spec, status, questions, isDevGen,
        toggle: () => status === "idle" ? connect() : disconnect(),
        generateDevSpec
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
    ),
    Doc: () => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
    ),
    ArrowRight: () => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    ),
    Close: () => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    )
};

// --- Animations & Visualizers ---
const spring = { type: "spring" as const, stiffness: 300, damping: 30 };

const AudioVisualizer = () => (
    <div className="visualizer">
        {[1,2,3,4].map(i => (
            <motion.div 
                key={i}
                className="bar"
                animate={{ height: [10, 24, 10] }}
                transition={{ 
                    duration: 0.5, 
                    repeat: Infinity, 
                    delay: i * 0.1,
                    ease: "easeInOut"
                }} 
            />
        ))}
        <style>{`
            .visualizer {
                display: flex; align-items: center; gap: 4px; height: 40px;
            }
            .bar {
                width: 4px; background: #FF3300; border-radius: 2px;
            }
        `}</style>
    </div>
);

// --- Main App ---
function App() {
    const { spec, status, questions, toggle, generateDevSpec, isDevGen } = useSpecAgent();
    const [view, setView] = useState<"chat"|"spec">("chat");
    const [activeQ, setActiveQ] = useState<string|null>(null);

    // Downloads
    const handleExport = async () => {
        const devSpec = await generateDevSpec();
        const download = (name: string, content: string) => {
            const blob = new Blob([content], {type:'text/markdown'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        };
        download("Brief.md", spec);
        if (devSpec) {
             download("Technical_Architecture.md", devSpec);
        }
    };

    return (
        <div className="stage">
            {/* Header */}
            <motion.header 
                className="header"
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
            >
                <div className="logo">S/B</div>
                <div className="status-indicator">
                    <div className={`dot ${status}`} />
                    <span>{status.toUpperCase()}</span>
                </div>
                <button className="icon-btn" onClick={() => setView("spec")}>
                    <Icons.Doc />
                </button>
            </motion.header>

            {/* Main Stage */}
            <AnimatePresence mode="wait">
                {view === "chat" ? (
                    <ChatView 
                        key="chat"
                        status={status}
                        questions={questions}
                        onListen={toggle}
                        onStop={toggle}
                        activeQ={activeQ}
                        setActiveQ={setActiveQ}
                    />
                ) : (
                    <SpecView 
                        key="spec"
                        spec={spec} 
                        onClose={() => setView("chat")} 
                        onExport={handleExport}
                        isGen={isDevGen}
                    />
                )}
            </AnimatePresence>
            
            <style>{`
                .stage {
                    width: 100vw; height: 100dvh;
                    position: relative;
                    display: flex; flex-direction: column;
                    background: #050505; color: white;
                    font-family: sans-serif;
                }
                .header {
                    position: absolute; top: 0; left: 0; right: 0;
                    padding: 24px 32px;
                    display: flex; justify-content: space-between; align-items: center;
                    z-index: 50;
                }
                .logo { font-family: 'Syne', sans-serif; font-weight: 800; font-size: 24px; letter-spacing: -1px; }
                .status-indicator {
                    display: flex; align-items: center; gap: 8px;
                    font-family: 'Manrope', monospace; font-size: 10px; letter-spacing: 2px;
                    color: #888;
                }
                .dot { width: 6px; height: 6px; border-radius: 50%; background: #888; transition: 0.3s; }
                .dot.listening { background: #FF3300; box-shadow: 0 0 10px #FF3300; }
                .dot.speaking { background: #fff; animation: blink 0.5s infinite; }
                .icon-btn {
                    background: none; border: none; color: white; cursor: pointer;
                    width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;
                    border-radius: 50%; transition: background 0.2s;
                }
                .icon-btn:hover { background: rgba(255,255,255,0.1); }
                @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
            `}</style>
        </div>
    );
}

// --- Chat / Interaction View ---
function ChatView({ status, questions, onListen, onStop, activeQ, setActiveQ }: any) {
    const isBento = status === "bento" || (questions.length > 0 && !activeQ);
    
    return (
        <motion.div 
            className="chat-layer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.5 }}
        >
            {/* The "Oracle" - Main Trigger */}
            {!isBento && !activeQ && (
                <div className="oracle-container">
                    <motion.h1 
                        className="hero-text"
                        layoutId="hero-text"
                        animate={{ 
                            opacity: status === "listening" ? 0.3 : 1,
                            scale: status === "listening" ? 0.95 : 1
                        }}
                    >
                        {status === "idle" && "Tap to Start\nVision Mode"}
                        {status === "listening" && "Listening..."}
                        {status === "speaking" && "Speaking..."}
                    </motion.h1>

                    {/* Interactive Trigger Area */}
                    <motion.button 
                        className="trigger-zone"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => status === "idle" ? onListen() : onStop()}
                    >
                        {status === "listening" || status === "speaking" ? (
                             <AudioVisualizer />
                        ) : (
                             <div className="mic-hint"><Icons.Mic /></div>
                        )}
                    </motion.button>
                </div>
            )}

            {/* Bento Grid Layer */}
            <AnimatePresence>
                {(isBento || activeQ) && (
                    <motion.div 
                        className="bento-wrapper"
                        initial={{ y: "100%" }}
                        animate={{ y: 0 }}
                        exit={{ y: "100%" }}
                        transition={spring}
                    >
                        <div className="bento-grid">
                            {questions.map((q: any, i: number) => {
                                const isActive = activeQ === q.id;
                                const isHidden = activeQ && !isActive;
                                
                                if (isHidden) return null;

                                return (
                                    <motion.div
                                        key={q.id}
                                        layoutId={q.id}
                                        className={`bento-card ${q.answered ? 'answered' : ''} ${isActive ? 'active' : ''}`}
                                        initial={{ opacity: 0, y: 50 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: i * 0.1, ...spring }}
                                        onClick={() => {
                                            if (q.answered) return;
                                            if (isActive) {
                                                // If already active, toggle recording
                                                status === "listening" ? onStop() : onListen(q.id);
                                            } else {
                                                // Expand card
                                                setActiveQ(q.id);
                                            }
                                        }}
                                        role="button"
                                        tabIndex={0}
                                    >
                                        <div className="card-content">
                                            <span className="q-label">0{i+1}</span>
                                            <h3>{q.text}</h3>
                                            {isActive && (
                                                <div className="card-actions">
                                                    <div className="status-text">
                                                        {status === "listening" ? "Listening..." : "Tap to Answer"}
                                                    </div>
                                                    <button className={`record-btn ${status === 'listening' ? 'rec' : ''}`}>
                                                        <Icons.Mic active={status === 'listening'} />
                                                    </button>
                                                </div>
                                            )}
                                            {isActive && (
                                                <button 
                                                    className="close-card" 
                                                    onClick={(e) => { e.stopPropagation(); setActiveQ(null); }}
                                                >
                                                    <Icons.Close />
                                                </button>
                                            )}
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <style>{`
                .chat-layer {
                    flex: 1; display: flex; flex-direction: column;
                    justify-content: center; align-items: center;
                    position: relative;
                }
                .oracle-container {
                    text-align: center; position: relative; z-index: 10;
                }
                .hero-text {
                    font-family: 'Syne', sans-serif; font-weight: 800;
                    font-size: clamp(3rem, 10vw, 6rem);
                    line-height: 0.9; letter-spacing: -2px;
                    color: white; margin: 0 0 40px 0;
                    white-space: pre-line;
                }
                .trigger-zone {
                    width: 100px; height: 100px;
                    border-radius: 50%;
                    border: 1px solid rgba(255,255,255,0.1);
                    background: transparent;
                    color: #888;
                    cursor: pointer;
                    display: flex; align-items: center; justify-content: center;
                    margin: 0 auto;
                }
                .bento-wrapper {
                    position: absolute; bottom: 0; left: 0; right: 0; top: 0;
                    background: rgba(5,5,5,0.8);
                    backdrop-filter: blur(20px);
                    padding: 24px;
                    display: flex; align-items: flex-end;
                    z-index: 20;
                }
                .bento-grid {
                    width: 100%; max-width: 600px; margin: 0 auto;
                    display: grid; gap: 16px;
                    grid-template-columns: 1fr;
                }
                .bento-card {
                    background: #111;
                    border: 1px solid #222;
                    border-radius: 24px;
                    padding: 24px;
                    cursor: pointer;
                    position: relative;
                    overflow: hidden;
                    transition: border-color 0.3s;
                }
                .bento-card.active {
                    position: absolute; bottom: 24px; left: 24px; right: 24px;
                    height: auto; min-height: 300px;
                    background: #161616;
                    border-color: #FF3300;
                    box-shadow: 0 20px 50px rgba(0,0,0,0.5);
                    z-index: 30;
                }
                .bento-card.answered {
                    opacity: 0.4;
                    pointer-events: none;
                    text-decoration: line-through;
                }
                .q-label {
                    font-family: 'Manrope'; font-size: 12px; color: #FF3300;
                    margin-bottom: 8px; display: block;
                }
                .bento-card h3 {
                    font-family: 'Syne'; font-size: 1.5rem; color: white; margin: 0;
                    font-weight: 700;
                }
                .bento-card.active h3 { font-size: 2.5rem; margin-bottom: 40px; }
                .card-actions {
                    display: flex; justify-content: space-between; align-items: center;
                    margin-top: 24px;
                }
                .record-btn {
                    width: 64px; height: 64px; border-radius: 32px;
                    background: #222; color: white; border: none;
                    display: flex; align-items: center; justify-content: center;
                }
                .record-btn.rec { background: #FF3300; color: black; }
                .close-card {
                    position: absolute; top: 24px; right: 24px;
                    background: none; border: none; color: white;
                    cursor: pointer;
                }
            `}</style>
        </motion.div>
    );
}

// --- Spec View ---
function SpecView({ spec, onClose, onExport, isGen }: any) {
    return (
        <motion.div 
            className="spec-panel"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={spring}
        >
            <div className="spec-inner">
                <div className="spec-toolbar">
                    <button onClick={onClose} className="back-btn"><Icons.ArrowRight /></button>
                    <button 
                        onClick={onExport} 
                        className="export-btn"
                        disabled={isGen}
                    >
                        {isGen ? "GENERATING..." : "FINALIZE & EXPORT"}
                    </button>
                </div>
                <div className="markdown-body">
                    <ReactMarkdown>{spec}</ReactMarkdown>
                </div>
            </div>
            <style>{`
                .spec-panel {
                    position: fixed; top: 0; right: 0; bottom: 0;
                    width: 100vw; max-width: 800px;
                    background: #0a0a0a;
                    border-left: 1px solid #222;
                    z-index: 100;
                    display: flex; flex-direction: column;
                }
                .spec-inner {
                    height: 100%; display: flex; flex-direction: column;
                }
                .spec-toolbar {
                    padding: 24px; border-bottom: 1px solid #222;
                    display: flex; justify-content: space-between;
                }
                .back-btn {
                    background: none; border: 1px solid #333; color: white;
                    width: 44px; height: 44px; border-radius: 50%;
                    transform: rotate(180deg); cursor: pointer;
                }
                .export-btn {
                    background: white; color: black; border: none;
                    padding: 0 24px; height: 44px; border-radius: 22px;
                    font-family: 'Manrope'; font-weight: 700; font-size: 12px;
                    letter-spacing: 1px; cursor: pointer;
                }
                .export-btn:disabled { opacity: 0.5; }
                .markdown-body {
                    flex: 1; overflow-y: auto; padding: 40px;
                    color: #ccc; font-family: 'Manrope'; line-height: 1.8;
                }
                .markdown-body h1 { color: white; font-family: 'Syne'; font-size: 3rem; margin-bottom: 2rem; }
                .markdown-body h2 { color: white; font-family: 'Syne'; margin-top: 3rem; border-bottom: 1px solid #333; padding-bottom: 10px; }
                .markdown-body strong { color: white; }
            `}</style>
        </motion.div>
    );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
