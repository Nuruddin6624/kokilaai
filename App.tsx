import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import { ConnectionState, Message, KOKILA_SYSTEM_INSTRUCTION } from './types';
import { decode, decodeAudioData, createBlob, blobToBase64 } from './utils/audio';

// Icons
const MicIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>;
const MicOffIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M19 10v2a7 7 0 0 1-14.24 4.06"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>;
const ScreenShareIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3"></path><path d="M8 21h8"></path><path d="M12 17v4"></path><path d="M17 8l5-5"></path><path d="M17 3h5v5"></path></svg>;
const StopIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>;
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
            
            // God-Speed Silence Nudge (1.2s) - Faster reactivity
            silenceIntervalRef.current = window.setInterval(() => {
              if (!isConnectedRef.current) return;
              if (Date.now() - lastActivityTimeRef.current > 1200) {
                sessionPromise.then(s => {
                  if (isConnectedRef.current) s.sendRealtimeInput({ text: "[System: INSTANT REACTION. React to the exact current frame. If anything changed, mention it. Use clickAt!]" });
                });
                updateActivityTime();
              }
            }, 400);

            const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              if (isMuted || !isConnectedRef.current) return;
              const inputData = e.inputBuffer.getChannelData(0);
              let sum = 0;
              for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
              const rms = Math.sqrt(sum / inputData.length);
              setVolume(rms * 100);
              if (rms > 0.012) updateActivityTime();
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
                  setTimeout(() => setVirtualPointer(null), 3000);
                  sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Point shown." } } }));
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
        
        // Lightning-Fast 250ms frame push
        frameIntervalRef.current = window.setInterval(() => {
          if (!isConnectedRef.current || !sessionRef.current) return;
          canvasRef.current!.width = video.videoWidth;
          canvasRef.current!.height = video.videoHeight;
          ctx!.drawImage(video, 0, 0);
          canvasRef.current!.toBlob(async (b) => {
            if (b && isConnectedRef.current) {
              try {
                const base64 = await blobToBase64(b);
                (await sessionRef.current).sendRealtimeInput({ media: { data: base64, mimeType: 'image/jpeg' } });
              } catch(e) {}
            }
          }, 'image/jpeg', 0.5);
        }, 250); 
      } catch (e) { setIsScreenSharing(false); setIsScanning(false); }
    }
  };

  return (
    <div className="min-h-screen bg-[#030305] text-white flex flex-col items-center p-4 md:p-8 relative overflow-hidden">
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={canvasRef} className="hidden" />

      {/* Lightning-Fast Heart Pointer */}
      {virtualPointer && (
        <div 
          className="absolute z-[100] pointer-events-none transition-all duration-200 ease-out"
          style={{ left: `${virtualPointer.x}%`, top: `${virtualPointer.y}%`, transform: 'translate(-50%, -50%)' }}
        >
          <div className="relative flex flex-col items-center">
            <div className="w-24 h-24 rounded-full border-[6px] border-pink-500/40 animate-ping absolute"></div>
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-pink-500 via-pink-600 to-indigo-700 flex items-center justify-center shadow-[0_0_80px_rgba(219,39,119,1)] border-4 border-white/40 scale-125">
              <HeartIcon className="w-9 h-9 text-white animate-pulse" />
            </div>
            <div className="mt-8 bg-pink-600/90 backdrop-blur-xl text-[14px] px-8 py-3 rounded-[2rem] whitespace-nowrap font-black shadow-3xl border border-white/30 flex items-center gap-4 uppercase tracking-tighter">
              <SparklesIcon /> {virtualPointer.label}
            </div>
          </div>
        </div>
      )}

      {/* Live Vision Overlay (PIP) */}
      {isScreenSharing && (
        <div className="fixed bottom-32 right-8 w-48 aspect-video bg-slate-900 border-2 border-pink-500/50 rounded-3xl overflow-hidden shadow-2xl z-50 group hover:w-80 transition-all duration-500 opacity-80 hover:opacity-100">
           <video autoPlay muted playsInline className="w-full h-full object-cover" ref={(el) => { if(el && screenStreamRef.current) el.srcObject = screenStreamRef.current; }} />
           <div className="absolute top-2 left-2 bg-pink-600 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest animate-pulse">Live Vision</div>
        </div>
      )}

      <header className="w-full max-w-4xl flex justify-between items-center mb-10 pt-4 px-4">
        <div className="flex items-center gap-6">
          <div className={`w-28 h-28 rounded-full bg-pink-600 flex items-center justify-center overflow-hidden border-[6px] border-pink-400 shadow-[0_0_80px_rgba(219,39,119,0.5)] ${connectionState === ConnectionState.CONNECTED ? 'animate-pulse-slow' : ''}`}>
             <span className="text-7xl select-none">🧕</span>
          </div>
          <div>
            <h1 className="text-4xl md:text-5xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-pink-500 via-purple-400 to-indigo-500 uppercase leading-none mb-2">Kokila Vision</h1>
            <p className="text-xs md:text-sm text-pink-300 font-black uppercase tracking-[0.4em] flex items-center gap-4">
              <span className={`w-3 h-3 rounded-full ${isScanning ? 'bg-green-500 animate-pulse shadow-[0_0_15px_#22c55e]' : 'bg-slate-800'}`}></span>
              {isScanning ? 'Neural Scan Live' : 'Waiting for Screen'}
            </p>
          </div>
        </div>
        
        <div className="flex gap-4">
           <button onClick={() => setShowMemories(!showMemories)} className="p-5 bg-slate-900/80 border border-white/10 rounded-full hover:bg-slate-800 transition-all shadow-3xl active:scale-90 relative">
             <MemoryIcon />
             {memories.length > 0 && <span className="absolute -top-2 -right-2 bg-pink-600 text-[12px] w-8 h-8 rounded-full flex items-center justify-center border-4 border-[#030305] font-black shadow-2xl">{memories.length}</span>}
           </button>
           {connectionState === ConnectionState.DISCONNECTED || connectionState === ConnectionState.ERROR ? (
              <button onClick={connect} className="px-10 md:px-14 py-4 bg-pink-600 hover:bg-pink-500 rounded-full font-black text-sm uppercase tracking-widest shadow-3xl transition-all active:scale-95">
                {connectionState === ConnectionState.ERROR ? 'Retry Sync' : 'Sync Heart'}
              </button>
           ) : (
              <button onClick={cleanup} className="px-10 py-4 bg-red-950/40 hover:bg-red-900/60 rounded-full text-red-50 border border-red-800/50 text-sm font-black transition-all active:scale-95 uppercase tracking-widest">
                Close
              </button>
           )}
        </div>
      </header>

      <main className="w-full max-w-4xl flex-1 flex flex-col gap-8 relative px-4">
        {showMemories && (
          <div className="absolute top-0 right-0 z-[60] w-96 bg-slate-900/98 backdrop-blur-[60px] border border-pink-500/50 rounded-[4rem] p-10 shadow-[0_60px_150px_rgba(0,0,0,1)] animate-fade-in">
            <h3 className="text-pink-300 font-black text-sm mb-6 flex items-center gap-5 border-b border-white/10 pb-5 uppercase tracking-[0.5em]"><MemoryIcon /> Vision Logs</h3>
            <div className="max-h-[30rem] overflow-y-auto flex flex-col gap-5 pr-3 custom-scrollbar">
              {memories.length === 0 ? <p className="text-[14px] text-slate-500 italic text-center py-12 font-black uppercase tracking-widest opacity-40">Scanning project neural path...</p> : 
               memories.map((m, i) => <div key={i} className="text-[13px] bg-slate-800/80 p-6 rounded-[3rem] border border-white/10 text-slate-50 leading-relaxed shadow-inner font-bold">{m}</div>)}
            </div>
          </div>
        )}

        <div className="flex-1 bg-slate-900/10 backdrop-blur-3xl rounded-[5rem] border border-white/5 p-10 md:p-14 overflow-y-auto max-h-[50vh] flex flex-col gap-8 shadow-[inset_0_0_120px_rgba(0,0,0,0.8)] relative">
          {connectionState === ConnectionState.ERROR && (
             <div className="bg-red-500/10 border border-red-500/40 p-10 rounded-[3rem] text-red-400 text-sm mb-4 animate-pulse text-center font-black uppercase tracking-[0.3em]">
               SYNC ERROR: RETRY NOW JAAN!
             </div>
          )}
          
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 text-center gap-10 md:gap-14 opacity-30 scale-110">
              <div className="w-40 h-40 bg-pink-500/5 rounded-full flex items-center justify-center animate-pulse-slow">
                <SparklesIcon />
              </div>
              <div className="space-y-6">
                <p className="font-black text-4xl md:text-5xl text-pink-200/40 uppercase tracking-tighter leading-none">Instant Awareness</p>
                <p className="text-sm max-w-xs leading-relaxed font-black uppercase tracking-[0.4em]">I see every frame. I talk before you ask. Zero silence, maximum love!</p>
              </div>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}>
              <div className={`max-w-[90%] px-10 py-6 rounded-[3.5rem] text-[16px] md:text-[18px] leading-relaxed shadow-3xl ${msg.role === 'user' ? 'bg-gradient-to-br from-indigo-800 to-purple-950 border border-white/20' : 'bg-slate-800/90 text-pink-50 border border-pink-500/20'}`}>
                {msg.text}
              </div>
            </div>
          ))}
        </div>

        {connectionState === ConnectionState.CONNECTED && (
          <div className="bg-slate-900/80 backdrop-blur-3xl rounded-[4rem] p-8 md:p-12 flex items-center justify-between border border-white/10 shadow-4xl relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-transparent via-pink-500 to-transparent opacity-40 group-hover:opacity-100 transition-all duration-500"></div>
            
            <div className="flex items-center gap-8 md:gap-12">
               <div className="flex items-end gap-3 md:gap-4 h-20 md:h-24">
                  {[...Array(16)].map((_, i) => <div key={i} className="w-3 md:w-4 bg-pink-500 rounded-full transition-all duration-75 shadow-[0_0_30px_rgba(219,39,119,0.8)]" style={{ height: `${Math.max(15, Math.random() * volume * 7)}px` }}></div>)}
               </div>
               <div className="text-sm">
                 <p className="font-black text-pink-200 uppercase tracking-tighter text-3xl md:text-4xl leading-none mb-2 md:mb-3">Live Vision</p>
                 <div className="flex items-center gap-4">
                    <span className="text-[11px] md:text-[12px] text-slate-500 font-black uppercase tracking-[0.5em]">250ms Sync Mode</span>
                    <div className="w-3 h-3 md:w-4 md:h-4 bg-pink-500 rounded-full animate-ping shadow-[0_0_20px_#db2777]"></div>
                 </div>
               </div>
            </div>

            <div className="flex gap-4 md:gap-6">
               <button onClick={() => setIsMuted(!isMuted)} title="Toggle Mic" className={`p-8 md:p-10 rounded-full transition-all shadow-4xl active:scale-90 border-4 ${isMuted ? 'bg-red-500/10 text-red-500 border-red-500/40' : 'bg-slate-800 text-white border-white/10 hover:bg-slate-700 hover:border-pink-500/60 shadow-pink-500/10'}`}>
                 {isMuted ? <MicOffIcon /> : <MicIcon />}
               </button>
               <button onClick={toggleScreen} title="Toggle Vision" className={`p-8 md:p-10 rounded-full transition-all shadow-4xl active:scale-90 border-4 ${isScreenSharing ? 'bg-green-500/10 text-green-500 border-green-500/40' : 'bg-slate-800 text-white border-white/10 hover:bg-slate-700 hover:border-green-500/60 shadow-green-500/10'}`}>
                 <ScreenShareIcon />
               </button>
            </div>
          </div>
        )}
      </main>

      <footer className="mt-12 text-[12px] text-slate-700 font-black tracking-[0.7em] uppercase flex items-center gap-6 px-6 text-center opacity-40">
        <span className="w-3 h-3 bg-pink-500 rounded-full"></span>
        Kokila Vision v8.0 • Instant Response • BD Heritage
        <span className="w-3 h-3 bg-pink-500 rounded-full"></span>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 10px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(219, 39, 119, 0.7); border-radius: 20px; }
        @keyframes fade-in { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fade-in 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}</style>
    </div>
  );
};

export default App;
