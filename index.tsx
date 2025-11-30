import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Type } from "@google/genai";
import ReactMarkdown from "react-markdown";
import { motion, AnimatePresence } from "framer-motion";

/**
 * ============================================================================
 * CONFIG & PROMPTS
 * ============================================================================
 */
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const PM_SYSTEM = `
You are a visionary Design Partner. Your goal is to extract a bold, clear vision from the user for their software idea.
Protocol:
1. Listen intently.
2. If the user's idea is vague, use the 'askFollowUpQuestions' tool to present 3 distinct, provocative angles (e.g., "Minimalist or Maximalist?", "Mobile-first or Desktop-power?").
3. If the idea is solid, use 'updateSpec' to crystallize it into a high-level brief.
4. Keep spoken responses short, punchy, and inspiring. Avoid corporate jargon.
`;

const ARCHITECT_SYSTEM = `
You are a Principal Engineer. Translate the provided User Vision into a rigorous Technical Specification.
Include: Architecture Diagrams (Mermaid), Database Schema, API Strategy, and Risk Analysis.
Output strict Markdown.
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
    const [status, setStatus] = useState<"idle"|"listening"|"processing"|"speaking"|"bento">("idle");
    const [isDevGen, setIsDevGen] = useState(false);

    // Refs to keep track of latest state inside async callbacks/effects
    const questionsRef = useRef(questions);
    const historyRef = useRef(history);
    const recognition = useRef<any>(null);
    const synth = useRef<SpeechSynthesis | null>(null);

    useEffect(() => { questionsRef.current = questions; }, [questions]);
    useEffect(() => { historyRef.current = history; }, [history]);

    // Initialize Speech once
    useEffect(() => {
        if (typeof window !== 'undefined') {
            if ('speechSynthesis' in window) {
                synth.current = window.speechSynthesis;
            }

            // Check for browser support
            if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
                const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
                if (SpeechRecognition) {
                    try {
                        recognition.current = new SpeechRecognition();
                        recognition.current.continuous = false;
                        recognition.current.interimResults = false;
                        recognition.current.lang = 'en-US';

                        // Default error handling
                        recognition.current.onerror = (e: any) => {
                            console.warn("Speech recognition error", e);
                            setStatus(prev => prev === "bento" ? "bento" : "idle");
                        };
                        recognition.current.onend = () => {
                            // If we were listening and it ended without explicit stop (silence), go back to idle
                            setStatus(prev => prev === "listening" ? "idle" : prev);
                        };
                    } catch (e) {
                        console.error("Failed to initialize speech recognition", e);
                    }
                }
            } else {
                console.warn("Speech Recognition API not supported in this browser.");
            }
        }
        return () => {
            if (recognition.current) {
                try { recognition.current.abort(); } catch(e){}
            }
            if (synth.current) {
                 synth.current.cancel();
            }
        };
    }, []);

    const speak = (text: string) => {
        if (!synth.current) return;

        // Cancel any current speaking
        synth.current.cancel();

        setStatus("speaking");
        const u = new SpeechSynthesisUtterance(text);

        const voices = synth.current.getVoices();
        // Try to find a good voice
        const preferred = voices.find(v => v.name.includes("Google") || v.name.includes("Samantha"));
        if (preferred) u.voice = preferred;

        u.rate = 1.05;
        u.pitch = 0.9;

        u.onend = () => {
            // Check current questions ref to decide next state
            if (questionsRef.current.some(q => !q.answered)) setStatus("bento");
            else setStatus("idle");
        };

        u.onerror = () => {
             setStatus("idle");
        }

        synth.current.speak(u);
    };

    const handleInput = async (text: string, questionId?: string) => {
        setStatus("processing");
        let context = text;

        // Use refs for latest state
        if (questionId) {
            const qText = questionsRef.current.find(q => q.id === questionId)?.text;
            context = `[Answering: "${qText}"]: ${text}`;
            // Optimistic update
            setQuestions(prev => prev.map(q => q.id === questionId ? {...q, answered: true} : q));
        }

        const currentHistory = historyRef.current;
        const newHistory = [...currentHistory, { role: "user", text: context }];
        setHistory(newHistory);

        try {
            const result = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [
                    { role: 'user', parts: [{ text: PM_SYSTEM }] },
                    ...newHistory.map(m => ({ role: m.role, parts: [{ text: m.text }] }))
                ],
                config: {
                    tools: [{ functionDeclarations: [
                        {
                            name: "updateSpec",
                            description: "Update the design brief.",
                            parameters: { type: Type.OBJECT, properties: { content: { type: Type.STRING } }, required: ["content"] }
                        },
                        {
                            name: "askFollowUpQuestions",
                            description: "Propose strategic questions.",
                            parameters: { 
                                type: Type.OBJECT, 
                                properties: { 
                                    intro: { type: Type.STRING },
                                    qs: { type: Type.ARRAY, items: { type: Type.STRING } }
                                }, 
                                required: ["intro", "qs"] 
                            }
                        }
                    ]}]
                }
            });

            const parts = result.candidates?.[0]?.content?.parts || [];
            let spoken = false;

            // Update history with model response
            let modelResponseText = "";

            for (const part of parts) {
                if (part.functionCall) {
                    const { name, args } = part.functionCall;
                    if (name === "updateSpec") {
                        setSpec((args as any).content);
                    } else if (name === "askFollowUpQuestions") {
                        const newQs = ((args as any).qs as string[]).map(t => ({
                            id: Math.random().toString(36).slice(2), text: t, answered: false
                        }));
                        setQuestions(newQs);
                        speak((args as any).intro);
                        spoken = true;
                        modelResponseText += `[Tool: askFollowUpQuestions]`;
                    }
                } else if (part.text) {
                    if (!spoken) {
                        speak(part.text);
                        spoken = true;
                    }
                    modelResponseText += part.text;
                }
            }

            // If nothing was spoken (e.g. just a spec update), speak a default confirmation
            if (!spoken) {
                speak("I've updated the brief.");
            }

            setHistory(prev => [...prev, { role: "model", text: modelResponseText || "Processed." }]);

        } catch (e) {
            console.error(e);
            setStatus("idle");
        }
    };

    const generateDevSpec = async () => {
        setIsDevGen(true);
        try {
            const result = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [
                    { role: 'user', parts: [{ text: ARCHITECT_SYSTEM }] },
                    { role: 'user', parts: [{ text: `Based on the approved User Vision, generate the Technical Specification:\n\n${spec}` }] }
                ]
            });
            setIsDevGen(false);
            return result.candidates?.[0]?.content?.parts?.[0]?.text;
        } catch (e) {
            console.error(e);
            setIsDevGen(false);
            return null;
        }
    };

    return {
        spec, status, questions, isDevGen,
        listen: (qid?: string) => { 
            if (!recognition.current) {
                console.warn("Speech recognition not available");
                return;
            }
            try {
                // Important: We override onresult here to capture the specific qid for THIS turn
                recognition.current.onresult = (e: any) => handleInput(e.results[0][0].transcript, qid);
                recognition.current.start();
                setStatus("listening"); 
            } catch(e) {
                console.warn("Speech recognition already active or failed", e);
            }
        },
        stop: () => { 
            if (recognition.current) try { recognition.current.stop(); } catch(e){} 
            setStatus("idle"); 
        },
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

// --- Animations ---
const spring = { type: "spring" as const, stiffness: 300, damping: 30 };

// --- Main App ---
function App() {
    const { spec, status, questions, listen, stop, generateDevSpec, isDevGen } = useSpecAgent();
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
                        onListen={listen}
                        onStop={stop}
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
                    color: var(--smoke);
                }
                .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--smoke); transition: 0.3s; }
                .dot.listening { background: var(--signal); box-shadow: 0 0 10px var(--signal); }
                .dot.processing { background: #fff; animation: blink 0.5s infinite; }
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
                        {status === "idle" && "Tell me your\nvision."}
                        {status === "listening" && "Listening..."}
                        {status === "processing" && "Thinking..."}
                        {status === "speaking" && "Speaking..."}
                    </motion.h1>

                    {/* Interactive Trigger Area */}
                    <motion.button 
                        className="trigger-zone"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => status === "idle" ? onListen() : onStop()}
                    >
                        {status === "listening" ? (
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
                    color: var(--smoke);
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
                    border-color: var(--signal);
                    box-shadow: 0 20px 50px rgba(0,0,0,0.5);
                    z-index: 30;
                }
                .bento-card.answered {
                    opacity: 0.4;
                    pointer-events: none;
                    text-decoration: line-through;
                }
                .q-label {
                    font-family: 'Manrope'; font-size: 12px; color: var(--signal);
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
                .record-btn.rec { background: var(--signal); color: black; }
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

// --- Visualizer Component ---
function AudioVisualizer() {
    return (
        <div className="bars">
            {[1,2,3,4,5].map(i => (
                <motion.div 
                    key={i}
                    className="bar"
                    animate={{ height: [10, 40, 10] }}
                    transition={{ 
                        repeat: Infinity, 
                        duration: 0.5 + Math.random() * 0.5,
                        ease: "easeInOut"
                    }}
                />
            ))}
            <style>{`
                .bars { display: flex; gap: 4px; align-items: center; height: 40px; }
                .bar { width: 4px; background: var(--signal); border-radius: 2px; }
            `}</style>
        </div>
    );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
