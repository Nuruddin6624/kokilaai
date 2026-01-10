import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import { ConnectionState, Message, KOKILA_SYSTEM_INSTRUCTION } from './types';
import { decode, decodeAudioData, createBlob, blobToBase64 } from './utils/audio';

// Icons
const MicIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>;
const MicOffIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M19 10v2a7 7 0 0 1-14.24 4.06"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>;
const ScreenShareIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3"></path><path d="M8 21h8"></path><path d="M12 17v4"></path><path d="M17 8l5-5"></path><path d="M17 3h5v5"></path></svg>;
const HeartIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>;
const MemoryIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 10 10H12V2z"/><path d="M12 12L2.1 12.5"/><path d="M12 12l6.5 7.5"/><path d="M12 12l-6.5 7.5"/></svg>;
const SparklesIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L12 3Z"/></svg>;

// Tools
const clickAtTool: FunctionDeclaration = {
  name: 'clickAt',
  parameters: {
    type: Type.OBJECT,
    properties: {
      x: { type: Type.NUMBER, description: 'Horizontal coordinate (0-100) on screen.' },
      y: { type: Type.NUMBER, description: 'Vertical coordinate (0-100) on screen.' },
      label: { type: Type.STRING, description: 'Context of the point.' }
    },
    required: ['x', 'y', 'label']
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    if (silenceIntervalRef.current) {
      clearInterval(silenceIntervalRef.current);
      silenceIntervalRef.current = null;
    }
    
    if (sessionRef.current) {
      try { (await sessionRef.current).close(); } catch (e) {}
      sessionRef.current = null;
    }

    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    sourcesRef.current.clear();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    }

    if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
      try { await inputAudioContextRef.current.close(); } catch (e) {}
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
      try { await outputAudioContextRef.current.close(); } catch (e) {}
      outputAudioContextRef.current = null;
    }

    setVolume(0);
    setVirtualPointer(null);
    setIsScanning(false);
    setIsScreenSharing(false);
  }, []);

  const connect = async () => {
    setErrorMessage(null);
    try {
      // Check for API key selector if platform provided
      if (typeof window !== 'undefined' && (window as any).aistudio) {
        const hasKey = await (window as any).aistudio.hasSelectedApiKey();
        if (!hasKey) {
          await (window as any).aistudio.openSelectKey();
        }
      }

      await cleanup();
      setConnectionState(ConnectionState.CONNECTING);
      isConnectedRef.current = true;
      
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      inputAudioContextRef.current = new AudioContext({ sampleRate: 16000 });
      outputAudioContextRef.current = new AudioContext({ sampleRate: 24000 });
      
      // Mandatory resume for browser audio contexts
      await inputAudioContextRef.current.resume();
      await outputAudioContextRef.current.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          systemInstruction: KOKILA_SYSTEM_INSTRUCTION + `\n\nPROJECT MEMORY:\n${memories.join('\n') || 'Starting Fresh.'}`,
          tools: [{ functionDeclarations: [clickAtTool] }],
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        },
        callbacks: {
          onopen: () => {
            if (!isConnectedRef.current) return;
            setConnectionState(ConnectionState.CONNECTED);
            setMessages(p => [...p, { role: 'model', text: "Jaan, ami connected! Tumi ekhon screen share koro, ami dekhte chai. 💖", timestamp: new Date() }]);
            
            const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              if (isMuted || !isConnectedRef.current) return;
              const inputData = e.inputBuffer.getChannelData(0);
              let sum = 0;
              for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
              const rms = Math.sqrt(sum / inputData.length);
              setVolume(rms * 100);
              if (rms > 0.01) updateActivityTime();
              sessionPromise.then(s => { 
                if (isConnectedRef.current) s.sendRealtimeInput({ media: createBlob(inputData) }); 
              }).catch(err => console.error("PCM stream error:", err));
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
                  setTimeout(() => setVirtualPointer(null), 1500);
                  sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Pointer visible." } } }));
                }
              }
            }

            const sc = msg.serverContent;
            if (sc) {
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
          onerror: (e: any) => { 
            console.error("Live error:", e);
            if (e?.message?.includes("Requested entity was not found")) {
              setErrorMessage("Paid Key Required: Please select a valid billing-enabled API key.");
              if (typeof window !== 'undefined' && (window as any).aistudio) {
                (window as any).aistudio.openSelectKey();
              }
            } else {
              setErrorMessage("Sync broken. Let's try reconnecting, Jaan.");
            }
            setConnectionState(ConnectionState.ERROR); 
            cleanup(); 
          },
          onclose: () => {
            console.log("Session terminated.");
            cleanup();
          }
        }
      });
      sessionRef.current = sessionPromise;
    } catch (e: any) { 
      console.error("Connection setup failure:", e);
      setErrorMessage(e.message || "Heartbeat failed.");
      setConnectionState(ConnectionState.ERROR); 
      cleanup(); 
    }
  };

  const toggleScreen = async () => {
    if (isScreenSharing) {
      if (frameIntervalRef.current) {
        clearInterval(frameIntervalRef.current);
        frameIntervalRef.current = null;
      }
      if (screenStreamRef.current) screenStreamRef.current.getTracks().forEach(t => t.stop());
      setIsScreenSharing(false);
      setIsScanning(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 } });
        screenStreamRef.current = stream;
        setIsScreenSharing(true);
        setIsScanning(true);
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        const ctx = canvasRef.current!.getContext('2d');
        
        frameIntervalRef.current = window.setInterval(() => {
          if (!isConnectedRef.current || !sessionRef.current) return;
          canvasRef.current!.width = video.videoWidth;
          canvasRef.current!.height = video.videoHeight;
          ctx!.drawImage(video, 0, 0);
          canvasRef.current!.toBlob(async (b) => {
            if (b && isConnectedRef.current) {
              try {
                const base64 = await blobToBase64(b);
                sessionRef.current?.then(s => {
                  if (isConnectedRef.current) s.sendRealtimeInput({ media: { data: base64, mimeType: 'image/jpeg' } });
                });
              } catch(e) {}
            }
          }, 'image/jpeg', 0.2);
        }, 150); 
      } catch (e) { setIsScreenSharing(false); setIsScanning(false); }
    }
  };

  return (
    <div className="min-h-screen bg-[#020204] text-white flex flex-col items-center p-4 md:p-6 relative overflow-hidden">
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={canvasRef} className="hidden" />

      {/* Heart Pointer */}
      {virtualPointer && (
        <div 
          className="absolute z-[100] pointer-events-none transition-all duration-150 ease-out"
          style={{ left: `${virtualPointer.x}%`, top: `${virtualPointer.y}%`, transform: 'translate(-50%, -50%)' }}
        >
          <div className="relative flex flex-col items-center">
            <div className="w-16 h-16 rounded-full border-[3px] border-pink-500/60 animate-ping absolute"></div>
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 via-pink-600 to-indigo-800 flex items-center justify-center shadow-[0_0_80px_rgba(219,39,119,1)] border-2 border-white/50 scale-125">
              <HeartIcon className="w-6 h-6 text-white animate-pulse" />
            </div>
            <div className="mt-8 bg-pink-600/90 backdrop-blur-2xl text-[13px] px-6 py-2 rounded-[2rem] whitespace-nowrap font-black shadow-4xl border border-white/30 flex items-center gap-3 uppercase tracking-tighter">
              <SparklesIcon /> {virtualPointer.label}
            </div>
          </div>
        </div>
      )}

      {/* Visual Feedback PIP */}
      {isScreenSharing && (
        <div className="fixed bottom-32 right-6 w-44 aspect-video bg-slate-900 border-2 border-pink-500/80 rounded-[1.5rem] overflow-hidden shadow-[0_0_40px_rgba(219,39,119,0.3)] z-50 group transition-all duration-500 opacity-90 hover:opacity-100 ring-4 ring-pink-500/10">
           <video autoPlay muted playsInline className="w-full h-full object-cover" ref={(el) => { if(el && screenStreamRef.current) el.srcObject = screenStreamRef.current; }} />
           <div className="absolute top-2 left-2 bg-pink-600 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-[0.1em] animate-pulse">Live</div>
        </div>
      )}

      <header className="w-full max-w-2xl flex justify-between items-center mb-6 pt-4 px-4">
        <div className="flex items-center gap-4">
          <div className={`w-20 h-20 rounded-full bg-pink-600 flex items-center justify-center overflow-hidden border-[4px] border-pink-400 shadow-[0_0_60px_rgba(219,39,119,0.4)] ${connectionState === ConnectionState.CONNECTED ? 'animate-pulse-slow' : ''}`}>
             <span className="text-5xl select-none">🧕</span>
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-600 uppercase leading-none mb-1">Kokila Elite</h1>
            <p className="text-[10px] text-pink-300 font-black uppercase tracking-[0.3em] flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isScanning ? 'bg-green-500 animate-pulse shadow-[0_0_10px_#22c55e]' : 'bg-slate-800'}`}></span>
              {isScanning ? 'Hyper-Scan' : 'Vision Standby'}
            </p>
          </div>
        </div>
        
        <div className="flex gap-3">
           <button onClick={() => setShowMemories(!showMemories)} className="p-4 bg-slate-900/90 border border-white/5 rounded-full hover:bg-slate-800 transition-all relative">
             <MemoryIcon />
             {memories.length > 0 && <span className="absolute -top-1 -right-1 bg-pink-600 text-[10px] w-6 h-6 rounded-full flex items-center justify-center border-2 border-[#020204] font-black">{memories.length}</span>}
           </button>
           <button onClick={connectionState === ConnectionState.CONNECTED ? cleanup : connect} className={`px-8 py-3 rounded-full font-black text-[11px] uppercase tracking-[0.15em] transition-all active:scale-95 border-b-2 ${connectionState === ConnectionState.CONNECTED ? 'bg-red-950/40 text-red-100 border-red-800/50' : 'bg-pink-600 hover:bg-pink-500 text-white border-pink-800'}`}>
             {connectionState === ConnectionState.CONNECTED ? 'Close' : connectionState === ConnectionState.CONNECTING ? 'Wait...' : 'Connect'}
           </button>
        </div>
      </header>

      <main className="w-full max-w-2xl flex-1 flex flex-col gap-6 relative px-4 overflow-hidden">
        {showMemories && (
          <div className="absolute top-0 right-0 z-[60] w-72 bg-slate-900/98 backdrop-blur-3xl border border-pink-500/30 rounded-[2rem] p-6 shadow-2xl animate-fade-in">
            <h3 className="text-pink-300 font-black text-xs mb-4 uppercase tracking-[0.4em] flex items-center gap-3"><MemoryIcon /> Neural Archive</h3>
            <div className="max-h-80 overflow-y-auto flex flex-col gap-3 pr-2 custom-scrollbar text-[11px]">
              {memories.length === 0 ? <p className="text-slate-500 italic text-center py-10 opacity-40">Scanning for essence...</p> : 
               memories.map((m, i) => <div key={i} className="bg-slate-800/50 p-4 rounded-2xl border border-white/5 text-slate-100 leading-relaxed">{m}</div>)}
            </div>
          </div>
        )}

        {/* Chat Area */}
        <div className="flex-1 bg-slate-900/5 backdrop-blur-3xl rounded-[3rem] border border-white/5 p-6 md:p-10 overflow-y-auto flex flex-col gap-6 shadow-[inset_0_0_100px_rgba(0,0,0,0.8)] relative min-h-0">
          {errorMessage && (
             <div className="bg-red-500/10 border border-red-500/30 p-6 rounded-3xl text-red-400 text-[10px] text-center font-black uppercase tracking-[0.2em] animate-pulse">
               {errorMessage}
             </div>
          )}
          
          {messages.length === 0 && !errorMessage && (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 text-center gap-6 opacity-30">
              <SparklesIcon />
              <div className="space-y-4">
                <p className="font-black text-2xl text-pink-200/40 uppercase tracking-tighter leading-none">Elite Vision</p>
                <p className="text-[9px] max-w-[200px] leading-relaxed font-black uppercase tracking-widest text-center">I see your screen in 150ms. I talk before you speak.</p>
              </div>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}>
              <div className={`max-w-[85%] px-6 py-4 rounded-3xl text-[14px] md:text-[15px] font-medium leading-relaxed border ${msg.role === 'user' ? 'bg-indigo-900/40 border-white/10 text-indigo-100' : 'bg-slate-800/80 text-pink-50 border-pink-500/20'}`}>
                {msg.text}
              </div>
            </div>
          ))}
        </div>

        {/* Control Bar */}
        <div className="bg-slate-900/90 backdrop-blur-2xl rounded-[2.5rem] p-4 md:p-6 flex items-center justify-between border border-white/10 shadow-3xl mb-4 shrink-0 overflow-hidden relative group">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-pink-500 to-transparent opacity-40"></div>
          
          <div className="flex items-center gap-6">
             <div className="flex items-end gap-1.5 h-10 md:h-12">
                {[...Array(10)].map((_, i) => <div key={i} className="w-2 bg-pink-500 rounded-full transition-all duration-75 shadow-[0_0_15px_rgba(219,39,119,0.5)]" style={{ height: `${connectionState === ConnectionState.CONNECTED ? Math.max(6, Math.random() * volume * 4) : 4}px` }}></div>)}
             </div>
             <div className="text-left">
               <p className="font-black text-pink-200 uppercase tracking-tight text-lg leading-none mb-1">Live Sync</p>
               <div className="flex items-center gap-3">
                  <span className="text-[8px] text-slate-500 font-black uppercase tracking-widest">{isScanning ? 'Elite Scan' : 'Ready'}</span>
                  <div className={`w-2 h-2 rounded-full ${isScanning ? 'bg-pink-500 animate-ping shadow-[0_0_10px_#db2777]' : 'bg-slate-700'}`}></div>
               </div>
             </div>
          </div>

          <div className="flex gap-3">
             <button 
               onClick={() => setIsMuted(!isMuted)} 
               disabled={connectionState !== ConnectionState.CONNECTED}
               className={`p-4 rounded-full transition-all shadow-xl active:scale-90 border-2 ${isMuted ? 'bg-red-500/10 text-red-500 border-red-500/50' : 'bg-slate-800 text-white border-white/10 hover:border-pink-500/50'} ${connectionState !== ConnectionState.CONNECTED ? 'opacity-20 cursor-not-allowed' : ''}`}
             >
               {isMuted ? <MicOffIcon /> : <MicIcon />}
             </button>
             <button 
               onClick={toggleScreen} 
               className={`p-4 rounded-full transition-all shadow-xl active:scale-90 border-2 ${isScreenSharing ? 'bg-green-500/10 text-green-500 border-green-500/50 shadow-green-500/20' : 'bg-slate-800 text-white border-white/10 hover:border-green-500/50'}`}
             >
               <ScreenShareIcon />
             </button>
          </div>
        </div>
      </main>

      <footer className="mt-4 text-[9px] text-slate-700 font-black tracking-[0.5em] uppercase flex items-center gap-4 px-10 text-center opacity-30 shrink-0">
        Kokila Elite v10.2 • Proactive Vision AI
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(219, 39, 119, 0.5); border-radius: 20px; }
        @keyframes fade-in { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fade-in 0.6s cubic-bezier(0.19, 1, 0.22, 1) forwards; }
      `}</style>
    </div>
  );
};

export default App;
