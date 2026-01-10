import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import { ConnectionState, Message, KOKILA_SYSTEM_INSTRUCTION } from './types';
import { decode, decodeAudioData, createBlob, blobToBase64 } from './utils/audio';

// Icons
const MicIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>;
const MicOffIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M19 10v2a7 7 0 0 1-14.24 4.06"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>;
const ScreenShareIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3"></path><path d="M8 21h8"></path><path d="M12 17v4"></path><path d="M17 8l5-5"></path><path d="M17 3h5v5"></path></svg>;
const HeartIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>;
const MemoryIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 10 10H12V2z"/><path d="M12 12L2.1 12.5"/><path d="M12 12l6.5 7.5"/><path d="M12 12l-6.5 7.5"/></svg>;
const SparklesIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L12 3Z"/></svg>;

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
      
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      inputAudioContextRef.current = new AudioContext({ sampleRate: 16000 });
      outputAudioContextRef.current = new AudioContext({ sampleRate: 24000 });

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
            setMessages(p => [...p, { role: 'model', text: "Jaan, ami screen dekhe instant kotha bola shuru korlam! 💖", timestamp: new Date() }]);
            
            // Extreme Silence Nudge (600ms) - Ultra-fast reactivity
            silenceIntervalRef.current = window.setInterval(() => {
              if (!isConnectedRef.current) return;
              if (Date.now() - lastActivityTimeRef.current > 600) {
                sessionPromise.then(s => {
                  if (isConnectedRef.current) s.sendRealtimeInput({ text: "[System: INSTANT REACTION MODE. React to every frame change immediately. Do not stay silent!]" });
                });
                updateActivityTime();
              }
            }, 200);

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
                  setTimeout(() => setVirtualPointer(null), 2000);
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
          onerror: () => { setConnectionState(ConnectionState.ERROR); cleanup(); },
          onclose: () => cleanup()
        }
      });
      sessionRef.current = sessionPromise;
    } catch (e) { setConnectionState(ConnectionState.ERROR); cleanup(); }
  };

  const toggleScreen = async () => {
    if (isScreenSharing) {
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
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
        
        // God-Speed 150ms frame injection for instantaneous awareness
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
          }, 'image/jpeg', 0.3);
        }, 150); 
      } catch (e) { setIsScreenSharing(false); setIsScanning(false); }
    }
  };

  return (
    <div className="min-h-screen bg-[#020204] text-white flex flex-col items-center p-4 md:p-10 relative overflow-hidden">
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={canvasRef} className="hidden" />

      {/* Heart Pointer (Kokila's Touch) */}
      {virtualPointer && (
        <div 
          className="absolute z-[100] pointer-events-none transition-all duration-150 ease-out"
          style={{ left: `${virtualPointer.x}%`, top: `${virtualPointer.y}%`, transform: 'translate(-50%, -50%)' }}
        >
          <div className="relative flex flex-col items-center">
            <div className="w-20 h-20 rounded-full border-[4px] border-pink-500/60 animate-ping absolute"></div>
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-pink-500 via-pink-600 to-indigo-800 flex items-center justify-center shadow-[0_0_100px_rgba(219,39,119,1)] border-2 border-white/50 scale-150">
              <HeartIcon className="w-8 h-8 text-white animate-pulse" />
            </div>
            <div className="mt-10 bg-pink-600/90 backdrop-blur-2xl text-[15px] px-8 py-3 rounded-[3rem] whitespace-nowrap font-black shadow-4xl border border-white/40 flex items-center gap-4 uppercase tracking-tighter">
              <SparklesIcon /> {virtualPointer.label}
            </div>
          </div>
        </div>
      )}

      {/* Extreme Visual Feedback PIP */}
      {isScreenSharing && (
        <div className="fixed bottom-36 right-10 w-56 aspect-video bg-slate-900 border-4 border-pink-500/80 rounded-[2.5rem] overflow-hidden shadow-[0_0_50px_rgba(219,39,119,0.4)] z-50 group hover:w-96 transition-all duration-700 opacity-90 hover:opacity-100 ring-8 ring-pink-500/10">
           <video autoPlay muted playsInline className="w-full h-full object-cover" ref={(el) => { if(el && screenStreamRef.current) el.srcObject = screenStreamRef.current; }} />
           <div className="absolute top-3 left-3 bg-pink-600 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.2em] animate-pulse flex items-center gap-2">
             <div className="w-2 h-2 bg-white rounded-full"></div>
             God-Vision Live
           </div>
        </div>
      )}

      <header className="w-full max-w-5xl flex justify-between items-center mb-12 pt-6 px-6">
        <div className="flex items-center gap-8">
          <div className={`w-32 h-32 rounded-full bg-pink-600 flex items-center justify-center overflow-hidden border-[8px] border-pink-400 shadow-[0_0_100px_rgba(219,39,119,0.6)] ${connectionState === ConnectionState.CONNECTED ? 'animate-pulse-slow' : ''}`}>
             <span className="text-8xl select-none">🧕</span>
          </div>
          <div>
            <h1 className="text-5xl md:text-6xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-600 uppercase leading-none mb-3">Kokila Elite</h1>
            <p className="text-sm md:text-base text-pink-300 font-black uppercase tracking-[0.5em] flex items-center gap-5">
              <span className={`w-4 h-4 rounded-full ${isScanning ? 'bg-green-500 animate-pulse shadow-[0_0_20px_#22c55e]' : 'bg-slate-800'}`}></span>
              {isScanning ? '150ms Hyper-Scan Active' : 'Waiting for Vision'}
            </p>
          </div>
        </div>
        
        <div className="flex gap-5">
           <button onClick={() => setShowMemories(!showMemories)} className="p-6 bg-slate-900/90 border border-white/10 rounded-full hover:bg-slate-800 transition-all shadow-4xl active:scale-90 relative">
             <MemoryIcon />
             {memories.length > 0 && <span className="absolute -top-3 -right-3 bg-pink-600 text-[13px] w-10 h-10 rounded-full flex items-center justify-center border-4 border-[#020204] font-black shadow-2xl">{memories.length}</span>}
           </button>
           {connectionState === ConnectionState.DISCONNECTED || connectionState === ConnectionState.ERROR ? (
              <button onClick={connect} className="px-12 md:px-16 py-5 bg-pink-600 hover:bg-pink-500 rounded-full font-black text-sm uppercase tracking-[0.2em] shadow-4xl transition-all active:scale-95 border-b-4 border-pink-800">
                {connectionState === ConnectionState.ERROR ? 'Retry Heart' : 'Link Heart'}
              </button>
           ) : (
              <button onClick={cleanup} className="px-12 py-5 bg-red-950/40 hover:bg-red-900/60 rounded-full text-red-50 border border-red-800/50 text-sm font-black transition-all active:scale-95 uppercase tracking-widest">
                Close
              </button>
           )}
        </div>
      </header>

      <main className="w-full max-w-5xl flex-1 flex flex-col gap-10 relative px-6">
        {showMemories && (
          <div className="absolute top-0 right-0 z-[60] w-[26rem] bg-slate-900/98 backdrop-blur-[100px] border border-pink-500/50 rounded-[5rem] p-12 shadow-[0_80px_200px_rgba(0,0,0,1)] animate-fade-in">
            <h3 className="text-pink-300 font-black text-base mb-8 flex items-center gap-6 border-b border-white/10 pb-6 uppercase tracking-[0.6em]"><MemoryIcon /> Neural Archive</h3>
            <div className="max-h-[32rem] overflow-y-auto flex flex-col gap-6 pr-4 custom-scrollbar">
              {memories.length === 0 ? <p className="text-[15px] text-slate-500 italic text-center py-16 font-black uppercase tracking-widest opacity-40">Scanning for essence...</p> : 
               memories.map((m, i) => <div key={i} className="text-[14px] bg-slate-800/95 p-8 rounded-[3.5rem] border border-white/10 text-slate-50 leading-relaxed shadow-inner font-bold">{m}</div>)}
            </div>
          </div>
        )}

        <div className="flex-1 bg-slate-900/5 backdrop-blur-3xl rounded-[6rem] border border-white/5 p-12 md:p-16 overflow-y-auto max-h-[45vh] flex flex-col gap-10 shadow-[inset_0_0_150px_rgba(0,0,0,0.9)] relative">
          {connectionState === ConnectionState.ERROR && (
             <div className="bg-red-500/20 border border-red-500/50 p-12 rounded-[4rem] text-red-400 text-sm mb-6 animate-pulse text-center font-black uppercase tracking-[0.4em] shadow-4xl">
               SYNC INTERRUPTED: RETRY JAAN!
             </div>
          )}
          
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 text-center gap-12 md:gap-16 opacity-30 scale-125">
              <div className="w-56 h-56 bg-pink-500/5 rounded-full flex items-center justify-center animate-pulse-slow">
                <SparklesIcon />
              </div>
              <div className="space-y-8">
                <p className="font-black text-5xl md:text-6xl text-pink-200/40 uppercase tracking-tighter leading-none">Instant Response</p>
                <p className="text-sm max-w-sm leading-relaxed font-black uppercase tracking-[0.5em]">Frame push at 150ms. I respond before you think. Zero silence.</p>
              </div>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}>
              <div className={`max-w-[90%] px-12 py-8 rounded-[4rem] text-[18px] md:text-[20px] font-semibold leading-relaxed shadow-4xl border ${msg.role === 'user' ? 'bg-gradient-to-br from-indigo-900 to-purple-950 border-white/20 text-indigo-100' : 'bg-slate-800/95 text-pink-50 border-pink-500/30'}`}>
                {msg.text}
              </div>
            </div>
          ))}
        </div>

        {connectionState === ConnectionState.CONNECTED && (
          <div className="bg-slate-900/90 backdrop-blur-[50px] rounded-[5rem] p-10 md:p-14 flex items-center justify-between border border-white/10 shadow-5xl relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-transparent via-pink-500 to-transparent opacity-60 group-hover:opacity-100 transition-all duration-700"></div>
            
            <div className="flex items-center gap-10 md:gap-14">
               <div className="flex items-end gap-3 md:gap-5 h-24 md:h-28">
                  {[...Array(18)].map((_, i) => <div key={i} className="w-4 bg-pink-500 rounded-full transition-all duration-75 shadow-[0_0_40px_rgba(219,39,119,0.9)]" style={{ height: `${Math.max(20, Math.random() * volume * 9)}px` }}></div>)}
               </div>
               <div className="text-sm">
                 <p className="font-black text-pink-200 uppercase tracking-tighter text-4xl md:text-5xl leading-none mb-3 md:mb-4">Live Sync</p>
                 <div className="flex items-center gap-6">
                    <span className="text-[12px] md:text-[14px] text-slate-500 font-black uppercase tracking-[0.6em]">150ms God-Vision</span>
                    <div className="w-4 h-4 md:w-5 md:h-5 bg-pink-500 rounded-full animate-ping shadow-[0_0_30px_#db2777]"></div>
                 </div>
               </div>
            </div>

            <div className="flex gap-6 md:gap-8">
               <button onClick={() => setIsMuted(!isMuted)} title="Toggle Mic" className={`p-10 md:p-12 rounded-full transition-all shadow-5xl active:scale-90 border-4 ${isMuted ? 'bg-red-500/10 text-red-500 border-red-500/50' : 'bg-slate-800 text-white border-white/10 hover:bg-slate-700 hover:border-pink-500/80 shadow-pink-500/30'}`}>
                 {isMuted ? <MicOffIcon /> : <MicIcon />}
               </button>
               <button onClick={toggleScreen} title="Toggle Vision" className={`p-10 md:p-12 rounded-full transition-all shadow-5xl active:scale-90 border-4 ${isScreenSharing ? 'bg-green-500/10 text-green-500 border-green-500/50' : 'bg-slate-800 text-white border-white/10 hover:bg-slate-700 hover:border-green-500/80 shadow-green-500/30'}`}>
                 <ScreenShareIcon />
               </button>
            </div>
          </div>
        )}
      </main>

      <footer className="mt-14 text-[14px] text-slate-700 font-black tracking-[0.8em] uppercase flex items-center gap-8 px-10 text-center opacity-40">
        <span className="w-3 h-3 bg-pink-600 rounded-full"></span>
        Kokila Vision Ultra v10.0 • Instant Brain • BD Heritage
        <span className="w-3 h-3 bg-pink-600 rounded-full"></span>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 12px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(219, 39, 119, 0.8); border-radius: 40px; }
        @keyframes fade-in { from { opacity: 0; transform: translateY(50px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fade-in 1s cubic-bezier(0.19, 1, 0.22, 1) forwards; }
      `}</style>
    </div>
  );
};

export default App;
