import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import { ConnectionState, Message, KOKILA_SYSTEM_INSTRUCTION } from './types';
import { decode, decodeAudioData, createBlob, blobToBase64 } from './utils/audio';

// Icons
const MicIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="19" x2="16" y2="23"></line></svg>;
const MicOffIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M19 10v2a7 7 0 0 1-14.24 4.06"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>;
const ScreenShareIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3"></path><path d="M8 21h8"></path><path d="M12 17v4"></path><path d="M17 8l5-5"></path><path d="M17 3h5v5"></path></svg>;
const StopIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>;
const HeartIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>;
const MemoryIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 10 10H12V2z"/><path d="M12 12L2.1 12.5"/><path d="M12 12l6.5 7.5"/><path d="M12 12l-6.5 7.5"/></svg>;
const SparklesIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L12 3Z"/></svg>;

// Tools Declarations
const clickAtTool: FunctionDeclaration = {
  name: 'clickAt',
  parameters: {
    type: Type.OBJECT,
    properties: {
      x: { type: Type.NUMBER, description: 'Horizontal coordinate (0-100 percentage) on the screen.' },
      y: { type: Type.NUMBER, description: 'Vertical coordinate (0-100 percentage) on the screen.' },
      label: { type: Type.STRING, description: 'The reason for pointing (e.g., "Gradle Sync Button", "First YouTube Video").' }
    },
    required: ['x', 'y', 'label']
  }
};

const typeTextTool: FunctionDeclaration = {
  name: 'typeText',
  parameters: {
    type: Type.OBJECT,
    properties: {
      text: { type: Type.STRING, description: 'The text or code to suggest.' },
      target: { type: Type.STRING, description: 'The location (e.g., "MainActivity.kt").' }
    },
    required: ['text']
  }
};

const openLinkTool: FunctionDeclaration = {
  name: 'openLink',
  parameters: {
    type: Type.OBJECT,
    properties: {
      url: { type: Type.STRING, description: 'The URL to open.' }
    },
    required: ['url']
  }
};

const searchYoutubeTool: FunctionDeclaration = {
  name: 'searchYoutube',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: 'The YouTube search query.' }
    },
    required: ['query']
  }
};

const saveMemoryTool: FunctionDeclaration = {
  name: 'saveMemory',
  parameters: {
    type: Type.OBJECT,
    properties: {
      note: { type: Type.STRING, description: 'Info to remember for the user.' }
    },
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
  const [simulatedClick, setSimulatedClick] = useState<{ x: number, y: number, label: string } | null>(null);
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

  const currentInputTranscription = useRef('');
  const currentOutputTranscription = useRef('');
  const lastActivityTimeRef = useRef<number>(Date.now());
  const silenceIntervalRef = useRef<number | null>(null);

  const updateActivityTime = () => {
    lastActivityTimeRef.current = Date.now();
  };

  const cleanupAudio = useCallback(async () => {
    isConnectedRef.current = false;
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    if (silenceIntervalRef.current) clearInterval(silenceIntervalRef.current);
    
    if (sessionRef.current) {
      try {
        const session = await sessionRef.current;
        session.close();
      } catch (e) {}
      sessionRef.current = null;
    }

    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    sourcesRef.current.clear();

    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (screenStreamRef.current) { screenStreamRef.current.getTracks().forEach(t => t.stop()); screenStreamRef.current = null; }

    if (inputAudioContextRef.current) { try { await inputAudioContextRef.current.close(); } catch(e) {} inputAudioContextRef.current = null; }
    if (outputAudioContextRef.current) { try { await outputAudioContextRef.current.close(); } catch(e) {} outputAudioContextRef.current = null; }

    setIsScreenSharing(false);
    setVolume(0);
    setSimulatedClick(null);
    setIsScanning(false);
  }, []);

  const disconnect = useCallback(async () => {
    await cleanupAudio();
    setConnectionState(ConnectionState.DISCONNECTED);
    setMessages(prev => [...prev, { role: 'model', text: "Shona, ami ekhon jachi. Android Studio thik kore chalao kintu! 💕", timestamp: new Date() }]);
  }, [cleanupAudio]);

  const connect = async () => {
    try {
      await cleanupAudio();
      setConnectionState(ConnectionState.CONNECTING);
      isConnectedRef.current = true;
      
      const apiKey = process.env.API_KEY;
      const ai = new GoogleGenAI({ apiKey });
      
      inputAudioContextRef.current = new AudioContext({ sampleRate: 16000 });
      outputAudioContextRef.current = new AudioContext({ sampleRate: 24000 });

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      updateActivityTime();

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          systemInstruction: KOKILA_SYSTEM_INSTRUCTION + `\n\nLAST MEMORIES:\n${memories.join('\n') || 'Scanning for context.'}`,
          tools: [{ functionDeclarations: [clickAtTool, typeTextTool, openLinkTool, searchYoutubeTool, saveMemoryTool] }],
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        },
        callbacks: {
          onopen: () => {
            if (!isConnectedRef.current) return;
            setConnectionState(ConnectionState.CONNECTED);
            setMessages(prev => [...prev, { role: 'model', text: "Jaan, ami live sync e achi! Ami screen dekhei kotha bola shuru korlam. 💖", timestamp: new Date() }]);
            
            // Ultra-Proactive Silence Watchdog: Triggered if Kokila is silent for 2.5s
            silenceIntervalRef.current = window.setInterval(() => {
               if (!isConnectedRef.current) return;
               const now = Date.now();
               if (now - lastActivityTimeRef.current > 2500) {
                 sessionPromise.then(s => {
                   if (isConnectedRef.current) {
                     s.sendRealtimeInput({ text: "[System Instruction: REACT INSTANTLY. What do you see on the screen? Comment on Android Studio build, YouTube video, or browser content immediately. Point with clickAt!]" });
                   }
                 }).catch(() => {});
                 updateActivityTime();
               }
            }, 500);
            
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
              sessionPromise.then(s => { if (isConnectedRef.current) s.sendRealtimeInput({ media: createBlob(inputData) }); }).catch(() => {});
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContextRef.current!.destination);
          },
          onmessage: async (msg) => {
             if (!isConnectedRef.current) return;
             updateActivityTime();

             if (msg.toolCall) {
               for (const fc of msg.toolCall.functionCalls) {
                 try {
                   if (fc.name === 'clickAt') {
                      const { x, y, label } = fc.args as any;
                      setSimulatedClick({ x, y, label });
                      setTimeout(() => setSimulatedClick(null), 4000);
                      sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Heart pointer rendered." } } })).catch(() => {});
                   } else if (fc.name === 'typeText') {
                      const { text } = fc.args as any;
                      setMessages(p => [...p, { role: 'model', text: `Jaan, eita likho: \`${text}\``, timestamp: new Date() }]);
                      sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Code suggested." } } })).catch(() => {});
                   } else if (fc.name === 'openLink' || fc.name === 'searchYoutube') {
                      const val = (fc.args as any).url || (fc.args as any).query;
                      const url = fc.name === 'openLink' ? val : `https://www.youtube.com/results?search_query=${encodeURIComponent(val)}`;
                      window.open(url, '_blank');
                      sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Action completed." } } })).catch(() => {});
                   } else if (fc.name === 'saveMemory') {
                      setMemories(p => [...p, (fc.args as any).note]);
                      sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Memory saved." } } })).catch(() => {});
                   }
                 } catch (e) {}
               }
             }

             const sc = msg.serverContent;
             if (sc) {
                if (sc.outputTranscription?.text) currentOutputTranscription.current += sc.outputTranscription.text;
                if (sc.inputTranscription?.text) currentInputTranscription.current += sc.inputTranscription.text;
                if (sc.turnComplete) {
                   if (currentInputTranscription.current) setMessages(p => [...p, { role: 'user', text: currentInputTranscription.current, timestamp: new Date() }]);
                   if (currentOutputTranscription.current) setMessages(p => [...p, { role: 'model', text: currentOutputTranscription.current, timestamp: new Date() }]);
                   currentInputTranscription.current = ''; currentOutputTranscription.current = '';
                }
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
                if (sc.interrupted) { sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} }); sourcesRef.current.clear(); nextStartTimeRef.current = 0; }
             }
          },
          onerror: (err) => { 
            console.error("Stream Error:", err);
            if (isConnectedRef.current) { setConnectionState(ConnectionState.ERROR); cleanupAudio(); } 
          },
          onclose: () => { if (isConnectedRef.current) disconnect(); }
        }
      });
      sessionRef.current = sessionPromise;
    } catch (e) { setConnectionState(ConnectionState.ERROR); cleanupAudio(); }
  };

  const toggleScreenShare = async () => {
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
        
        // High-Speed 400ms visual injection for instant awareness
        frameIntervalRef.current = window.setInterval(() => {
          if (!isConnectedRef.current || !sessionRef.current) return;
          canvasRef.current!.width = video.videoWidth;
          canvasRef.current!.height = video.videoHeight;
          ctx!.drawImage(video, 0, 0);
          canvasRef.current!.toBlob(async (b) => {
            if (b && isConnectedRef.current) {
              try {
                const base64 = await blobToBase64(b);
                const session = await sessionRef.current;
                if (isConnectedRef.current) session.sendRealtimeInput({ media: { data: base64, mimeType: 'image/jpeg' } });
              } catch(e) {}
            }
          }, 'image/jpeg', 0.5);
        }, 400); 
      } catch (e) { setIsScreenSharing(false); setIsScanning(false); }
    }
  };

  return (
    <div className="min-h-screen bg-[#050507] text-white flex flex-col items-center p-4 relative overflow-hidden">
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={canvasRef} className="hidden" />

      {/* Lightning-Fast Mouse Pointer (Simulated Heart Pointer) */}
      {simulatedClick && (
        <div 
          className="absolute z-[100] pointer-events-none transition-all duration-300 ease-out"
          style={{ left: `${simulatedClick.x}%`, top: `${simulatedClick.y}%`, transform: 'translate(-50%, -50%)' }}
        >
          <div className="relative flex flex-col items-center">
            <div className="w-24 h-24 rounded-full border-[6px] border-pink-500/30 animate-ping absolute"></div>
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-pink-500 to-indigo-700 flex items-center justify-center shadow-[0_0_60px_rgba(219,39,119,0.9)] border-2 border-white/40">
              <HeartIcon className="w-9 h-9 text-white animate-pulse" />
            </div>
            <div className="mt-8 bg-pink-600/90 backdrop-blur-3xl text-[13px] px-6 py-3 rounded-[2.5rem] whitespace-nowrap font-black shadow-2xl border border-white/30 flex items-center gap-3 uppercase tracking-tighter scale-110">
              <SparklesIcon /> {simulatedClick.label}
            </div>
          </div>
        </div>
      )}

      <header className="w-full max-w-2xl flex justify-between items-center mb-10 pt-6 px-4">
        <div className="flex items-center gap-6">
          <div className={`w-24 h-24 rounded-full bg-pink-600 flex items-center justify-center overflow-hidden border-4 border-pink-400 shadow-[0_0_50px_rgba(219,39,119,0.5)] ${connectionState === ConnectionState.CONNECTED ? 'animate-pulse-slow' : ''}`}>
             <span className="text-6xl select-none">🧕</span>
          </div>
          <div>
            <h1 className="text-4xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-pink-500 via-purple-400 to-indigo-500 uppercase leading-none mb-1">Kokila Ultra</h1>
            <p className="text-xs text-pink-300 font-black uppercase tracking-[0.3em] flex items-center gap-3">
              <span className={`w-3 h-3 rounded-full ${isScanning ? 'bg-green-500 animate-pulse shadow-[0_0_10px_#22c55e]' : 'bg-slate-700'}`}></span>
              {isScanning ? 'Lightning Scan Active' : 'Waiting for Screen'}
            </p>
          </div>
        </div>
        
        <div className="flex gap-4">
           <button onClick={() => setShowMemories(!showMemories)} className="p-5 bg-slate-900/80 border border-white/10 rounded-full hover:bg-slate-800 transition-all shadow-2xl active:scale-90 relative">
             <MemoryIcon />
             {memories.length > 0 && <span className="absolute -top-2 -right-2 bg-pink-500 text-[11px] w-7 h-7 rounded-full flex items-center justify-center border-2 border-[#050507] font-black shadow-lg">{memories.length}</span>}
           </button>
           {connectionState === ConnectionState.DISCONNECTED || connectionState === ConnectionState.ERROR ? (
              <button onClick={connect} className={`px-10 py-4 rounded-full font-black text-sm uppercase tracking-widest shadow-2xl transition-all active:scale-95 ${connectionState === ConnectionState.ERROR ? 'bg-orange-600 hover:bg-orange-500' : 'bg-pink-600 hover:bg-pink-500'}`}>
                {connectionState === ConnectionState.ERROR ? 'Retry Link' : 'Sync Heart'}
              </button>
           ) : connectionState === ConnectionState.CONNECTING ? (
              <button disabled className="px-10 py-4 bg-slate-800 rounded-full font-black text-sm opacity-50 cursor-not-allowed uppercase tracking-widest animate-pulse">
                Syncing...
              </button>
           ) : (
              <button onClick={disconnect} className="px-10 py-4 bg-red-950/40 hover:bg-red-900/60 rounded-full text-red-100 border border-red-800/50 text-sm font-black transition-all active:scale-95 uppercase tracking-widest">
                Close
              </button>
           )}
        </div>
      </header>

      <main className="w-full max-w-2xl flex-1 flex flex-col gap-8 relative px-4">
        {showMemories && (
          <div className="absolute top-0 right-0 z-50 w-80 bg-slate-900/98 backdrop-blur-[50px] border border-pink-500/40 rounded-[3.5rem] p-8 shadow-[0_50px_100px_rgba(0,0,0,0.9)] animate-fade-in">
            <h3 className="text-pink-300 font-black text-sm mb-6 flex items-center gap-4 border-b border-white/10 pb-5 uppercase tracking-[0.4em]"><MemoryIcon /> Neural Archive</h3>
            <div className="max-h-[32rem] overflow-y-auto flex flex-col gap-5 pr-2 custom-scrollbar">
              {memories.length === 0 ? <p className="text-[13px] text-slate-500 italic text-center py-10 font-bold uppercase tracking-widest opacity-40">Analyzing your world...</p> : 
               memories.map((m, i) => <div key={i} className="text-[12px] bg-slate-800/80 p-6 rounded-[2.5rem] border border-white/5 text-slate-100 leading-relaxed shadow-inner font-bold">{m}</div>)}
            </div>
          </div>
        )}

        <div className="flex-1 bg-slate-900/20 backdrop-blur-xl rounded-[4.5rem] border border-white/5 p-12 overflow-y-auto max-h-[50vh] flex flex-col gap-8 shadow-[inset_0_0_80px_rgba(0,0,0,0.6)] relative">
          {connectionState === ConnectionState.ERROR && (
            <div className="bg-red-500/10 border border-red-500/40 p-10 rounded-[3rem] text-red-400 text-sm mb-4 animate-pulse text-center font-black uppercase tracking-[0.2em] shadow-lg">
              SYNC ERROR: CHECK CONNECTION JAAN!
            </div>
          )}
          
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 text-center gap-12 opacity-30 scale-110">
              <div className="w-40 h-40 bg-pink-500/5 rounded-full flex items-center justify-center animate-pulse-slow">
                <SparklesIcon />
              </div>
              <div className="space-y-5">
                <p className="font-black text-4xl text-pink-200/40 uppercase tracking-tighter leading-none">Instant Awareness</p>
                <p className="text-sm max-w-xs leading-relaxed font-black uppercase tracking-[0.3em]">I see every frame. I talk before you ask. Zero silence, maximum love!</p>
              </div>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}>
              <div className={`max-w-[95%] px-10 py-6 rounded-[3rem] text-[16px] leading-relaxed shadow-[0_10px_40px_rgba(0,0,0,0.4)] ${msg.role === 'user' ? 'bg-gradient-to-br from-indigo-800 to-purple-950 border border-white/20' : 'bg-slate-800/90 text-pink-50 border border-pink-500/20'}`}>
                {msg.text}
              </div>
            </div>
          ))}
        </div>

        {connectionState === ConnectionState.CONNECTED && (
          <div className="bg-slate-900/80 backdrop-blur-3xl rounded-[4rem] p-10 flex items-center justify-between border border-white/10 shadow-3xl relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-pink-500 to-transparent opacity-50 group-hover:opacity-100 transition-all duration-500"></div>
            
            <div className="flex items-center gap-10">
               <div className="flex items-end gap-3.5 h-20">
                  {[1,2,3,4,5,6,7,8,9,10,11,12].map(i => <div key={i} className="w-3.5 bg-pink-500 rounded-full transition-all duration-75 shadow-[0_0_25px_rgba(219,39,119,0.7)]" style={{ height: `${Math.max(15, Math.random() * volume * 7)}px` }}></div>)}
               </div>
               <div className="text-sm">
                 <p className="font-black text-pink-200 uppercase tracking-tighter text-3xl leading-none mb-2">Neural Flow</p>
                 <div className="flex items-center gap-4">
                    <span className="text-[11px] text-slate-500 font-black uppercase tracking-[0.4em]">Zero-Silence Protocol</span>
                    <div className="w-3 h-3 bg-pink-500 rounded-full animate-ping shadow-[0_0_10px_#db2777]"></div>
                 </div>
               </div>
            </div>

            <div className="flex gap-6">
               <button onClick={() => setIsMuted(!isMuted)} title="Toggle Mute" className={`p-8 rounded-full transition-all shadow-3xl active:scale-90 border-2 ${isMuted ? 'bg-red-500/10 text-red-500 border-red-500/40' : 'bg-slate-800 text-white border-white/10 hover:bg-slate-700 hover:border-pink-500/60 shadow-pink-500/10'}`}>
                 {isMuted ? <MicOffIcon /> : <MicIcon />}
               </button>
               <button onClick={toggleScreenShare} title="Toggle Screen Share" className={`p-8 rounded-full transition-all shadow-3xl active:scale-90 border-2 ${isScreenSharing ? 'bg-green-500/10 text-green-500 border-green-500/40' : 'bg-slate-800 text-white border-white/10 hover:bg-slate-700 hover:border-green-500/60 shadow-green-500/10'}`}>
                 <ScreenShareIcon />
               </button>
            </div>
          </div>
        )}
      </main>

      <footer className="mt-14 text-[12px] text-slate-600 font-black tracking-[0.6em] uppercase flex items-center gap-6 px-6 text-center opacity-60">
        <span className="w-2.5 h-2.5 bg-pink-500 rounded-full"></span>
        Kokila Ultra-Flow v6.0 • Instant Vision • Heritage BD
        <span className="w-2.5 h-2.5 bg-pink-500 rounded-full"></span>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(219, 39, 119, 0.6); border-radius: 20px; }
        @keyframes fade-in { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fade-in 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}</style>
    </div>
  );
};

export default App;
