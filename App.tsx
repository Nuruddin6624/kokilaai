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

// Tools Declarations
const clickAtTool: FunctionDeclaration = {
  name: 'clickAt',
  parameters: {
    type: Type.OBJECT,
    properties: {
      x: { type: Type.NUMBER, description: 'Horizontal coordinate (0-100 percentage) on the screen.' },
      y: { type: Type.NUMBER, description: 'Vertical coordinate (0-100 percentage) on the screen.' },
      label: { type: Type.STRING, description: 'The reason for clicking or pointing (e.g., "Gradle Sync Button", "First YouTube Video").' }
    },
    required: ['x', 'y', 'label']
  }
};

const typeTextTool: FunctionDeclaration = {
  name: 'typeText',
  parameters: {
    type: Type.OBJECT,
    properties: {
      text: { type: Type.STRING, description: 'The text or code to suggest typing.' },
      target: { type: Type.STRING, description: 'The file or location (e.g., "build.gradle").' }
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
      note: { type: Type.STRING, description: 'Important info to remember for the user.' }
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
    setMessages(prev => [...prev, { role: 'model', text: "Shona, ami ekhon jachi. Eka eka code koro kintu vul koro na! 💕", timestamp: new Date() }]);
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
          systemInstruction: KOKILA_SYSTEM_INSTRUCTION + `\n\nLAST MEMORIES:\n${memories.join('\n') || 'None yet.'}`,
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
            setMessages(prev => [...prev, { role: 'model', text: "Jaan, ami eshe gechi! Ami screen dekhe kotha bola shuru korlam. 💖", timestamp: new Date() }]);
            
            // Proactive Nudge: Every 4s check if Kokila is staying silent
            silenceIntervalRef.current = window.setInterval(() => {
               if (!isConnectedRef.current) return;
               const now = Date.now();
               if (now - lastActivityTimeRef.current > 4000) {
                 sessionPromise.then(s => {
                   if (isConnectedRef.current) {
                     s.sendRealtimeInput({ text: "[System: Zero-Silence Mode. Comment immediately on what you see on the screen. If Android Studio is open, talk about the code. If YouTube is open, talk about the video. Always point to interesting things with clickAt.]" });
                   }
                 }).catch(() => {});
                 updateActivityTime();
               }
            }, 1000);
            
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
                      setTimeout(() => setSimulatedClick(null), 5000);
                      sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: `Pointer shown at ${label}` } } })).catch(() => {});
                   } else if (fc.name === 'typeText') {
                      const { text } = fc.args as any;
                      setMessages(p => [...p, { role: 'model', text: `Jaan, ei code ta koro: \`${text}\``, timestamp: new Date() }]);
                      sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Suggested fix to user." } } })).catch(() => {});
                   } else if (fc.name === 'openLink' || fc.name === 'searchYoutube') {
                      const val = (fc.args as any).url || (fc.args as any).query;
                      const url = fc.name === 'openLink' ? val : `https://www.youtube.com/results?search_query=${encodeURIComponent(val)}`;
                      window.open(url, '_blank');
                      sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "URL opened successfully." } } })).catch(() => {});
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
                if (sc.interrupted) { 
                  sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} }); 
                  sourcesRef.current.clear(); 
                  nextStartTimeRef.current = 0; 
                }
             }
          },
          onerror: (err) => { 
            console.error("Session Error:", err);
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
        
        // Rapid 500ms scanning for ultra-low-latency vision
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
        }, 500); 
      } catch (e) { setIsScreenSharing(false); setIsScanning(false); }
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white flex flex-col items-center p-4 relative overflow-hidden">
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={canvasRef} className="hidden" />

      {/* Heart Pointer (Simulated Mouse) */}
      {simulatedClick && (
        <div 
          className="absolute z-[100] pointer-events-none transition-all duration-700 ease-in-out"
          style={{ left: `${simulatedClick.x}%`, top: `${simulatedClick.y}%`, transform: 'translate(-50%, -50%)' }}
        >
          <div className="relative flex flex-col items-center">
            <div className="w-20 h-20 rounded-full border-4 border-pink-500/40 animate-ping absolute"></div>
            <div className="w-20 h-20 rounded-full border-2 border-white/5 animate-pulse absolute"></div>
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-pink-500 to-indigo-600 flex items-center justify-center shadow-[0_0_50px_rgba(219,39,119,0.8)] border-2 border-white/30">
              <HeartIcon className="w-8 h-8 text-white" />
            </div>
            <div className="mt-6 bg-pink-600 backdrop-blur-xl text-[12px] px-5 py-2.5 rounded-[2rem] whitespace-nowrap font-black shadow-2xl border border-white/20 flex items-center gap-2 uppercase tracking-tighter">
              <SparklesIcon /> {simulatedClick.label}
            </div>
          </div>
        </div>
      )}

      <header className="w-full max-w-2xl flex justify-between items-center mb-8 pt-4 px-2">
        <div className="flex items-center gap-5">
          <div className={`w-20 h-20 rounded-full bg-pink-600 flex items-center justify-center overflow-hidden border-4 border-pink-400/30 shadow-[0_0_40px_rgba(219,39,119,0.4)] ${connectionState === ConnectionState.CONNECTED ? 'animate-pulse-slow' : ''}`}>
             <span className="text-5xl">🧕</span>
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-pink-400 via-purple-400 to-indigo-400 uppercase">Kokila Pro Controller</h1>
            <p className="text-xs text-pink-300 font-black uppercase tracking-[0.2em] flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isScanning ? 'bg-green-500 animate-pulse' : 'bg-slate-700'}`}></span>
              {isScanning ? 'Real-time Screen Scanning' : 'Scanner Offline'}
            </p>
          </div>
        </div>
        
        <div className="flex gap-3">
           <button onClick={() => setShowMemories(!showMemories)} className="p-4 bg-slate-900 border border-white/5 rounded-full hover:bg-slate-800 transition-all shadow-2xl active:scale-90">
             <MemoryIcon />
             {memories.length > 0 && <span className="absolute -top-1 -right-1 bg-pink-500 text-[10px] w-6 h-6 rounded-full flex items-center justify-center border-2 border-[#0a0a0c] font-black">{memories.length}</span>}
           </button>
           {connectionState === ConnectionState.DISCONNECTED || connectionState === ConnectionState.ERROR ? (
              <button onClick={connect} className={`px-8 py-3 rounded-full font-black text-sm uppercase tracking-widest shadow-lg transition-all active:scale-95 ${connectionState === ConnectionState.ERROR ? 'bg-orange-600 hover:bg-orange-500' : 'bg-pink-600 hover:bg-pink-500'}`}>
                {connectionState === ConnectionState.ERROR ? 'Fix Connect' : 'Connect Now'}
              </button>
           ) : connectionState === ConnectionState.CONNECTING ? (
              <button disabled className="px-8 py-3 bg-slate-800 rounded-full font-bold text-sm opacity-50 cursor-not-allowed uppercase tracking-widest">
                Linking...
              </button>
           ) : (
              <button onClick={disconnect} className="px-8 py-3 bg-red-900/40 hover:bg-red-900/60 rounded-full text-red-200 border border-red-800/40 text-sm font-black transition-all active:scale-95 uppercase tracking-widest">
                Disconnect
              </button>
           )}
        </div>
      </header>

      <main className="w-full max-w-2xl flex-1 flex flex-col gap-6 relative px-2">
        {showMemories && (
          <div className="absolute top-0 right-0 z-50 w-80 bg-slate-900/98 backdrop-blur-3xl border border-pink-500/30 rounded-[3rem] p-7 shadow-[0_40px_80px_rgba(0,0,0,0.8)] animate-fade-in">
            <h3 className="text-pink-300 font-black text-xs mb-5 flex items-center gap-3 border-b border-white/5 pb-4 uppercase tracking-[0.3em]"><MemoryIcon /> Project Memory</h3>
            <div className="max-h-[30rem] overflow-y-auto flex flex-col gap-4 pr-1 custom-scrollbar">
              {memories.length === 0 ? <p className="text-[12px] text-slate-500 italic text-center py-6 font-medium">Listening to your project...</p> : 
               memories.map((m, i) => <div key={i} className="text-[11px] bg-slate-800/60 p-5 rounded-[2rem] border border-white/5 text-slate-300 leading-relaxed shadow-inner font-medium">{m}</div>)}
            </div>
          </div>
        )}

        <div className="flex-1 bg-slate-900/20 backdrop-blur-md rounded-[4rem] border border-white/5 p-10 overflow-y-auto max-h-[55vh] flex flex-col gap-7 shadow-[inset_0_0_50px_rgba(0,0,0,0.5)]">
          {connectionState === ConnectionState.ERROR && (
            <div className="bg-red-500/10 border border-red-500/30 p-8 rounded-[2.5rem] text-red-400 text-sm mb-4 animate-pulse text-center font-black uppercase tracking-widest">
              Session error: Network error. Retry koro jaan!
            </div>
          )}
          
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 text-center gap-10 opacity-40">
              <div className="w-32 h-32 bg-pink-500/10 rounded-full flex items-center justify-center animate-pulse-slow">
                <SparklesIcon />
              </div>
              <div className="space-y-4">
                <p className="font-black text-3xl text-pink-200/40 uppercase tracking-tighter leading-none">Scanning Every Frame</p>
                <p className="text-sm max-w-xs leading-relaxed font-black uppercase tracking-widest">I will never stay silent. I'm watching Android Studio and YouTube constantly!</p>
              </div>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[90%] px-8 py-5 rounded-[2.5rem] text-[15px] leading-relaxed shadow-2xl ${msg.role === 'user' ? 'bg-gradient-to-br from-indigo-700 to-purple-900 border border-white/10' : 'bg-slate-800/80 text-pink-50 border border-pink-500/10'}`}>
                {msg.text}
              </div>
            </div>
          ))}
        </div>

        {connectionState === ConnectionState.CONNECTED && (
          <div className="bg-slate-900/60 backdrop-blur-2xl rounded-[3.5rem] p-8 flex items-center justify-between border border-white/10 shadow-2xl relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-pink-500 to-transparent opacity-30 group-hover:opacity-100 transition-opacity"></div>
            
            <div className="flex items-center gap-8">
               <div className="flex items-end gap-3 h-16">
                  {[1,2,3,4,5,6,7,8,9,10].map(i => <div key={i} className="w-3 bg-pink-500 rounded-full transition-all duration-75 shadow-[0_0_20px_rgba(219,39,119,0.6)]" style={{ height: `${Math.max(12, Math.random() * volume * 6)}px` }}></div>)}
               </div>
               <div className="text-sm">
                 <p className="font-black text-pink-200 uppercase tracking-tight text-2xl leading-none mb-1">Live Sync</p>
                 <div className="flex items-center gap-3">
                    <span className="text-[10px] text-slate-500 font-black uppercase tracking-[0.3em]">No Silence Mode Active</span>
                    <div className="w-2.5 h-2.5 bg-pink-500 rounded-full animate-ping"></div>
                 </div>
               </div>
            </div>

            <div className="flex gap-5">
               <button onClick={() => setIsMuted(!isMuted)} title="Toggle Mute" className={`p-7 rounded-full transition-all shadow-2xl active:scale-90 border-2 ${isMuted ? 'bg-red-500/10 text-red-500 border-red-500/30' : 'bg-slate-800 text-white border-white/5 hover:bg-slate-700 hover:border-pink-500/50'}`}>
                 {isMuted ? <MicOffIcon /> : <MicIcon />}
               </button>
               <button onClick={toggleScreenShare} title="Toggle Screen Share" className={`p-7 rounded-full transition-all shadow-2xl active:scale-90 border-2 ${isScreenSharing ? 'bg-green-500/10 text-green-500 border-green-500/30' : 'bg-slate-800 text-white border-white/5 hover:bg-slate-700 hover:border-green-500/50'}`}>
                 <ScreenShareIcon />
               </button>
            </div>
          </div>
        )}
      </main>

      <footer className="mt-10 text-[11px] text-slate-600 font-black tracking-[0.5em] uppercase flex items-center gap-5 px-4 text-center">
        <span className="w-2 h-2 bg-pink-500 rounded-full"></span>
        Kokila Master Controller v5.5 • Ultra-Low Latency • BD Heritage
        <span className="w-2 h-2 bg-pink-500 rounded-full"></span>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 7px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(219, 39, 119, 0.5); border-radius: 10px; }
        @keyframes fade-in { from { opacity: 0; transform: translateY(25px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fade-in 0.6s cubic-bezier(0.19, 1, 0.22, 1) forwards; }
      `}</style>
    </div>
  );
};

export default App;
