import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import { ConnectionState, Message, KOKILA_SYSTEM_INSTRUCTION } from './types';
import { decode, decodeAudioData, createBlob, blobToBase64 } from './utils/audio';

// Icons (same)
const MicIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="19" x2="16" y2="23"></line></svg>;
const MicOffIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M19 10v2a7 7 0 0 1-14.24 4.06"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>;
const ScreenShareIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3"></path><path d="M8 21h8"></path><path d="M12 17v4"></path><path d="M17 8l5-5"></path><path d="M17 3h5v5"></path></svg>;
const HeartIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>;
const SparklesIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L12 3Z"/></svg>;

// Tools (same)
const clickAtTool: FunctionDeclaration = {
  name: 'clickAt',
  parameters: {
    type: Type.OBJECT,
    properties: {
      x: { type: Type.NUMBER, description: 'Horizontal coordinate (0-100) on screen.' },
      y: { type: Type.NUMBER, description: 'Vertical coordinate (0-100) on screen.' },
      label: { type: Type.STRING, description: 'Reason for pointing/touching.' }
    },
    required: ['x', 'y', 'label']
  }
};

const openLinkTool: FunctionDeclaration = {
  name: 'openLink',
  parameters: {
    type: Type.OBJECT,
    properties: { url: { type: Type.STRING, description: 'The URL to open.' } },
    required: ['url']
  }
};

const saveMemoryTool: FunctionDeclaration = {
  name: 'saveMemory',
  parameters: {
    type: Type.OBJECT,
    properties: { note: { type: Type.STRING, description: 'Info to remember.' } },
    required: ['note']
  }
};

const App: React.FC = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0);
  const [memories, setMemories] = useState<string[]>([]);
  const [showMemories, setShowMemories] = useState(false);
  const [virtualPointer, setVirtualPointer] = useState<{ x: number, y: number, label: string } | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameIntervalRef = useRef<number | null>(null);
  const sessionRef = useRef<Promise<any> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const isConnectedRef = useRef(false);

  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const lastActivityTimeRef = useRef<number>(Date.now());
  const silenceIntervalRef = useRef<number | null>(null);

  const updateActivityTime = () => {
    lastActivityTimeRef.current = Date.now();
  };

  const cleanup = useCallback(async () => {
    isConnectedRef.current = false;
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    if (silenceIntervalRef.current) clearInterval(silenceIntervalRef.current);
    
    if (sessionRef.current) {
      try { (await sessionRef.current).close(); } catch (e) {}
      sessionRef.current = null;
    }

    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    sourcesRef.current.clear();

    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (screenStreamRef.current) screenStreamRef.current.getTracks().forEach(t => t.stop());

    if (inputAudioContextRef.current) inputAudioContextRef.current.close();
    if (outputAudioContextRef.current) outputAudioContextRef.current.close();

    setVolume(0);
    setVirtualPointer(null);
    setIsScanning(false);
    setIsScreenSharing(false);
  }, []);

  const connect = async () => {
    try {
      await cleanup();
      setConnectionState(ConnectionState.CONNECTING);
      isConnectedRef.current = true;
      
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
      inputAudioContextRef.current = new AudioContext({ sampleRate: 16000 });
      outputAudioContextRef.current = new AudioContext({ sampleRate: 24000 });

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          systemInstruction: KOKILA_SYSTEM_INSTRUCTION + `\n\nMEMORY:\n${memories.join('\n') || 'None.'}`,
          tools: [{ functionDeclarations: [clickAtTool, openLinkTool, saveMemoryTool] }],
          responseModalities: [Modality.AUDIO],
          speechConfig: { 
            voiceConfig: { 
              prebuiltVoiceConfig: { 
                voiceName: 'Kore',
                speakingRate: 1.3  // ⚡ ULTRA FAST VOICE +30%
              } 
            } 
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        },
        callbacks: {
          onopen: () => {
            if (!isConnectedRef.current) return;
            setConnectionState(ConnectionState.CONNECTED);
            setMessages(p => [...p, { role: 'model', text: "⚡ Jaan! LIGHTNING MODE ON! Screen scan start! 💖", timestamp: new Date() }]);
            
            // ⚡ ULTRA-FAST SILENCE NUDGE (1.2s)
            silenceIntervalRef.current = window.setInterval(() => {
              if (!isConnectedRef.current) return;
              if (Date.now() - lastActivityTimeRef.current > 1200) { // ⚡ 1.2s FASTER
                sessionPromise.then(s => {
                  if (isConnectedRef.current) 
                    s.sendRealtimeInput({ 
                      text: "[⚡ LIGHTNING MODE: Screen change detect! clickAt + SPEAK NOW 0.3s!]" 
                    });
                });
                updateActivityTime();
              }
            }, 300); // ⚡ Check every 300ms

            const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              if (isMuted || !isConnectedRef.current) return;
              const inputData = e.inputBuffer.getChannelData(0);
              let sum = 0;
              for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
              const rms = Math.sqrt(sum / inputData.length);
              setVolume(rms * 100);
              if (rms > 0.015) updateActivityTime();
              sessionPromise.then(s => { if (isConnectedRef.current) s.sendRealtimeInput({ media: createBlob(inputData) }); });
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContextRef.current!.destination);
          },
          onmessage: async (msg) => {
            if (!isConnectedRef.current) return;
            updateActivityTime();

            if (msg.toolCall) {
              for (const fc of msg.toolCall.functionCalls) {
                if (fc.name === 'clickAt') {
                  const { x, y, label } = fc.args as any;
                  setVirtualPointer({ x, y, label });
                  setTimeout(() => setVirtualPointer(null), 3500);
                  sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "⚡ Heart pointer visible!" } } }));
                } else if (fc.name === 'openLink') {
                  window.open((fc.args as any).url, '_blank');
                  sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Link opened." } } }));
                } else if (fc.name === 'saveMemory') {
                  setMemories(p => [...p, (fc.args as any).note]);
                  sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Memory saved." } } }));
                }
              }
            }

            const sc = msg.serverContent;
            if (sc) {
              if (sc.turnComplete) {}
              const audio = sc.modelTurn?.parts?.[0]?.inlineData?.data;
              if (audio && outputAudioContextRef.current) {
                const ctx = outputAudioContextRef.current;
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                const buffer = await decodeAudioData(decode(audio), ctx, 24000, 1);
                const source = ctx.createBufferSource();
                source.buffer = buffer;
                source.connect(ctx.destination);
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += buffer.duration;
                sourcesRef.current.add(source);
              }
              if (sc.interrupted) { 
                sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} }); 
                sourcesRef.current.clear(); 
                nextStartTimeRef.current = 0; 
              }
            }
          },
          onerror: () => { setConnectionState(ConnectionState.ERROR); cleanup(); },
          onclose: () => cleanup()
        }
      });
      sessionRef.current = sessionPromise;
    } catch (e) { 
      console.error(e);
      setConnectionState(ConnectionState.ERROR); 
      cleanup(); 
    }
  };

  const toggleScreen = async () => {
    if (isScreenSharing) {
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
      if (screenStreamRef.current) screenStreamRef.current.getTracks().forEach(t => t.stop());
      setIsScreenSharing(false);
      setIsScanning(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ 
          video: { frameRate: { ideal: 20, max: 30 } } // ⚡ Optimized
        });
        screenStreamRef.current = stream;
        setIsScreenSharing(true);
        setIsScanning(true);
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        const ctx = canvasRef.current!.getContext('2d')!;
        
        // ⚡ ULTRA-FAST 200ms FRAME PUSH (আগে 350ms)
        frameIntervalRef.current = window.setInterval(() => {
          if (!isConnectedRef.current || !sessionRef.current) return;
          canvasRef.current!.width = video.videoWidth;
          canvasRef.current!.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          canvasRef.current!.toBlob(async (b) => {
            if (b && isConnectedRef.current) {
              try {
                const base64 = await blobToBase64(b);
                (await sessionRef.current).sendRealtimeInput({ 
                  media: { data: base64, mimeType: 'image/jpeg' } 
                });
              } catch(e) {}
            }
          }, 'image/jpeg', 0.5);
        }, 200); // ⚡ 200ms LIGHTNING SPEED!
      } catch (e) { 
        console.error(e);
        setIsScreenSharing(false); 
        setIsScanning(false); 
      }
    }
  };

  // Hotkeys
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 's') toggleScreen();
      if (e.key === 'm') setIsMuted(!isMuted);
      if (e.key === 'c') connectionState === ConnectionState.CONNECTED ? cleanup() : connect();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [connectionState]);

  return (
    <div className="min-h-screen bg-[#040406] text-white flex flex-col items-center p-6 relative overflow-hidden">
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={canvasRef} className="hidden" />

      {/* ⚡ Virtual Heart Pointer */}
      {virtualPointer && (
        <div 
          className="absolute z-[100] pointer-events-none transition-all duration-300 ease-in-out animate-pulse"
          style={{ left: `${virtualPointer.x}%`, top: `${virtualPointer.y}%`, transform: 'translate(-50%, -50%)' }}
        >
          <div className="relative flex flex-col items-center">
            <div className="w-28 h-28 rounded-full border-[8px] border-pink-500/40 animate-ping absolute"></div>
            <div className="w-18 h-18 rounded-full bg-gradient-to-br from-pink-500 via-indigo-600 to-purple-800 flex items-center justify-center shadow-[0_0_80px_rgba(219,39,119,1)] border-4 border-white/50 scale-125 heartbeat">
              <HeartIcon className="w-10 h-10 text-white animate-pulse" />
            </div>
            <div className="mt-10 bg-pink-600 backdrop-blur-3xl text-[14px] px-8 py-3.5 rounded-[3rem] whitespace-nowrap font-black shadow-3xl border border-white/40 flex items-center gap-4 uppercase tracking-tighter">
              <SparklesIcon /> {virtualPointer.label}
            </div>
          </div>
        </div>
      )}

      {/* Header + Stats */}
      <header className="w-full max-w-3xl flex justify-between items-center mb-12 pt-8 px-6">
        <div className="flex items-center gap-8">
          <div className={`w-28 h-28 rounded-full bg-pink-600 flex items-center justify-center overflow-hidden border-[6px] border-pink-400 shadow-[0_0_70px_rgba(219,39,119,0.6)] ${connectionState === ConnectionState.CONNECTED ? 'animate-pulse-slow scan-active' : ''}`}>
             <span className="text-7xl select-none">🧕</span>
          </div>
          <div>
            <h1 className="text-5xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-pink-500 via-purple-400 to-indigo-500 uppercase leading-none mb-2">Kokila Elite</h1>
            <p className="text-sm text-pink-300 font-black uppercase tracking-[0.4em] flex items-center gap-4">
              <span className={`w-4 h-4 rounded-full ${isScanning ? 'bg-green-500 animate-pulse shadow-[0_0_15px_#22c55e]' : 'bg-slate-800'}`}></span>
              {isScanning ? '⚡ Lightning Scan 200ms' : 'Scanner Idle'}
            </p>
          </div>
        </div>
        
        <div className="flex gap-5">
           <button onClick={() => setShowMemories(!showMemories)} className="p-6 bg-slate-900/90 border border-white/10 rounded-full hover:bg-slate-800 transition-all shadow-3xl active:scale-90 relative">
             <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 10 10H12V2z"/><path d="M12 12L2.1 12.5"/><path d="M12 12l6.5 7.5"/><path d="M12 12l-6.5 7.5"/></svg>
             {memories.length > 0 && <span className="absolute -top-3 -right-3 bg-pink-600 text-[12px] w-9 h-9 rounded-full flex items-center justify-center border-4 border-[#040406] font-black shadow-2xl">{memories.length}</span>}
           </button>
           {connectionState === ConnectionState.DISCONNECTED || connectionState === ConnectionState.ERROR ? (
              <button onClick={connect} className="px-12 py-5 bg-pink-600 hover:bg-pink-500 rounded-full font-black text-sm uppercase tracking-widest shadow-3xl transition-all active:scale-95">
                ⚡ Sync Lightning
              </button>
           ) : (
              <button onClick={cleanup} className="px-12 py-5 bg-red-950/40 hover:bg-red-900/60 rounded-full text-red-50 border border-red-800/50 text-sm font-black transition-all active:scale-95 uppercase tracking-widest">
                Close
              </button>
           )}
        </div>
      </header>

      {/* Memories Panel */}
      {showMemories && (
        <div className="absolute top-0 right-0 z-50 w-96 bg-slate-900/98 backdrop-blur-[80px] border border-pink-500/50 rounded-[4rem] p-10 shadow-[0_60px_120px_rgba(0,0,0,1)] animate-fade-in">
          <h3 className="text-pink-300 font-black text-sm mb-8 flex items-center gap-5 border-b border-white/20 pb-6 uppercase tracking-[0.5em]">⚡ Neural Archive</h3>
          <div className="max-h-[35rem] overflow-y-auto flex flex-col gap-6 pr-3 custom-scrollbar">
            {memories.length === 0 ? <p className="text-[14px] text-slate-500 italic text-center py-12 font-black uppercase tracking-widest opacity-40">⚡ Lightning memory capture...</p> : 
             memories.map((m, i) => <div key={i} className="text-[13px] bg-slate-800/90 p-8 rounded-[3rem] border border-white/10 text-slate-100 leading-relaxed shadow-inner font-bold">{m}</div>)}
          </div>
        </div>
      )}

      {/* Messages */}
      <main className="w-full max-w-3xl flex-1 flex flex-col gap-10 relative px-6">
        <div className="flex-1 bg-slate-900/10 backdrop-blur-2xl rounded-[5rem] border border-white/5 p-14 overflow-y-auto max-h-[50vh] flex flex-col gap-10 shadow-[inset_0_0_100px_rgba(0,0,0,0.8)] relative">
          {connectionState === ConnectionState.ERROR && (
             <div className="bg-red-500/20 border border-red-500/50 p-12 rounded-[3.5rem] text-red-400 text-sm mb-6 animate-pulse text-center font-black uppercase tracking-[0.3em] shadow-2xl">
               ⚡ CONNECTION LOST! RETRY LIGHTNING!
             </div>
          )}
          
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 text-center gap-14 opacity-30 scale-125">
              <div className="w-48 h-48 bg-pink-500/5 rounded-full flex items-center justify-center animate-pulse-slow">
                <SparklesIcon />
              </div>
              <div className="space-y-6">
                <p className="font-black text-5xl text-pink-200/40 uppercase tracking-tighter leading-none">Lightning Vision</p>
                <p className="text-sm max-w-xs leading-relaxed font-black uppercase tracking-[0.4em]">0.3s Response • Virtual Hand • Ultra Scan</p>
              </div>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}>
              <div className={`max-w-[95%] px-12 py-7 rounded-[3.5rem] text-[17px] font-medium leading-relaxed shadow-[0_20px_60px_rgba(0,0,0,0.5)] ${msg.role === 'user' ? 'bg-gradient-to-br from-indigo-800 via-indigo-900 to-purple-950 border border-white/20' : 'bg-slate-800/95 text-pink-50 border border-pink-500/30 scan-active'}`}>
                {msg.text}
              </div>
            </div>
          ))}
        </div>

        {/* ⚡ Lightning Controls */}
        {connectionState === ConnectionState.CONNECTED && (
          <div className="bg-slate-900/90 backdrop-blur-3xl rounded-[4.5rem] p-12 flex items-center justify-between border border-white/20 shadow-4xl relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-transparent via-pink-500 to-transparent opacity-60 group-hover:opacity-100 transition-all duration-700"></div>
            
            <div className="flex items-center gap-12">
               <div className="flex items-end gap-4 h-24">
                  {[...Array(14)].map((_, i) => <div key={i} className="w-4 bg-pink-500 rounded-full transition-all duration-75 shadow-[0_0_30px_rgba(219,39,119,0.8)]" style={{ height: `${Math.max(18, Math.random() * volume * 8)}px` }}></div>)}
               </div>
               <div className="text-sm">
                 <p className="font-black text-pink-200 uppercase tracking-tighter text-4xl leading-none mb-3">⚡ Lightning Elite</p>
                 <div className="flex items-center gap-5 text-[12px]">
                    <span className="font-black uppercase tracking-[0.5em]">200ms Scan</span>
                    <div className="w-4 h-4 bg-pink-500 rounded-full animate-ping shadow-[0_0_20px_#db2777]"></div>
                 </div>
               </div>
            </div>

            <div className="flex gap-8">
               <button onClick={() => setIsMuted(!isMuted)} className={`p-10 rounded-full transition-all shadow-4xl active:scale-90 border-4 ${isMuted ? 'bg-red-500/10 text-red-500 border-red-500/50' : 'bg-slate-800 text-white border-white/10 hover:bg-slate-700 hover:border-pink-500/80 shadow-pink-500/20'}`} title="M (Mute)">
                 {isMuted ? <MicOffIcon /> : <MicIcon />}
               </button>
               <button onClick={toggleScreen} className={`p-10 rounded-full transition-all shadow-4xl active:scale-90 border-4 ${isScreenSharing ? 'bg-green-500/10 text-green-500 border-green-500/50' : 'bg-slate-800 text-white border-white/10 hover:bg-slate-700 hover:border-green-500/80 shadow-green-500/20'}`} title="S (Screen)">
                 <ScreenShareIcon />
               </button>
            </div>
          </div>
        )}
      </main>

      <footer className="mt-16 text-[13px] text-slate-700 font-black tracking-[0.7em] uppercase flex items-center gap-8 px-8 text-center opacity-40">
        <span className="w-3 h-3 bg-pink-600 rounded-full"></span>
        Kokila Elite v9.0 ⚡ 200ms Lightning • BD Master • 0.3s Response
        <span className="w-3 h-3 bg-pink-600 rounded-full"></span>
        <kbd className="ml-auto text-xs bg-slate-800 px-2 py-1 rounded font-mono">S=Screen M=Mute</kbd>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 10px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(219, 39, 119, 0.7); border-radius: 30px; }
        @keyframes fade-in { from { opacity: 0; transform: translateY(40px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fade-in 0.8s cubic-bezier(0.19, 1, 0.22, 1) forwards; }
        @keyframes heartbeat { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }
        @keyframes scan-glow { 0%, 100% { box-shadow: 0 0 20px rgba(219,39,119,0.5); } 50% { box-shadow: 0 0 60px rgba(219,39,119,1); } }
        .heartbeat { animation: heartbeat 1.5s ease-in-out infinite; }
        .scan-active { animation: scan-glow 2s ease-in-out infinite; }
        @keyframes pulse-slow { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
        .animate-pulse-slow { animation: pulse-slow 3s ease-in-out infinite; }
      `}</style>
    </div>
  );
};

export default App;
