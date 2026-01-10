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

const editImageTool: FunctionDeclaration = {
  name: 'editImage',
  parameters: {
    type: Type.OBJECT,
    properties: {
      prompt: {
        type: Type.STRING,
        description: 'Description of the edit.'
      }
    },
    required: ['prompt']
  }
};

const openLinkTool: FunctionDeclaration = {
  name: 'openLink',
  parameters: {
    type: Type.OBJECT,
    properties: {
      url: {
        type: Type.STRING,
        description: 'The URL to open.'
      }
    },
    required: ['url']
  }
};

const searchYoutubeTool: FunctionDeclaration = {
  name: 'searchYoutube',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: 'YouTube search query.'
      }
    },
    required: ['query']
  }
};

const saveMemoryTool: FunctionDeclaration = {
  name: 'saveMemory',
  parameters: {
    type: Type.OBJECT,
    properties: {
      note: {
        type: Type.STRING,
        description: 'Important information about the user to remember.'
      }
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
  
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [isProcessingImage, setIsProcessingImage] = useState(false);

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

  const cleanupAudio = useCallback(() => {
    isConnectedRef.current = false;
    if (sessionRef.current) {
      sessionRef.current.then(session => session.close().catch(() => {}));
      sessionRef.current = null;
    }
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    if (silenceIntervalRef.current) clearInterval(silenceIntervalRef.current);
    sourcesRef.current.forEach(s => { try { s.stop(); } catch {} });
    sourcesRef.current.clear();
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (screenStreamRef.current) screenStreamRef.current.getTracks().forEach(t => t.stop());
    if (inputAudioContextRef.current) inputAudioContextRef.current.close().catch(() => {});
    if (outputAudioContextRef.current) outputAudioContextRef.current.close().catch(() => {});
    setIsScreenSharing(false);
    setVolume(0);
  }, []);

  const disconnect = useCallback(() => {
    cleanupAudio();
    setConnectionState(ConnectionState.DISCONNECTED);
    setMessages(prev => [...prev, { role: 'model', text: "Shona, ami ekhon jachi. Pore kotha hobe! 💕", timestamp: new Date() }]);
  }, [cleanupAudio]);

  const connect = async () => {
    try {
      cleanupAudio();
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
          systemInstruction: KOKILA_SYSTEM_INSTRUCTION + `\nTomar ekhonkar memory holo: ${memories.join(', ') || 'kichu na'}`,
          tools: [{ functionDeclarations: [editImageTool, openLinkTool, searchYoutubeTool, saveMemoryTool] }],
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        },
        callbacks: {
          onopen: () => {
            if (!isConnectedRef.current) return;
            setConnectionState(ConnectionState.CONNECTED);
            setMessages(prev => [...prev, { role: 'model', text: "Jaan, ami eshe gechi! Tomar screen dekhte ready. 💖", timestamp: new Date() }]);
            
            silenceIntervalRef.current = window.setInterval(() => {
               if (!isConnectedRef.current) return;
               const now = Date.now();
               if (now - lastActivityTimeRef.current > 12000) {
                 sessionPromise.then(s => s.sendRealtimeInput({ 
                   text: "[System: User silent for 12s. If screen sharing, check if they are stuck in code. If not, say something romantic about Dhaka's weather or your love.]" 
                 }));
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
              sessionPromise.then(s => isConnectedRef.current && s.sendRealtimeInput({ media: createBlob(inputData) }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContextRef.current!.destination);
          },
          onmessage: async (msg) => {
             if (!isConnectedRef.current) return;
             updateActivityTime();

             if (msg.toolCall) {
               for (const fc of msg.toolCall.functionCalls) {
                 if (fc.name === 'openLink') {
                    window.open((fc.args as any).url, '_blank');
                    sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "ok" } } }));
                 } else if (fc.name === 'searchYoutube') {
                    const q = (fc.args as any).query;
                    window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, '_blank');
                    sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "ok" } } }));
                 } else if (fc.name === 'saveMemory') {
                    const note = (fc.args as any).note;
                    setMemories(prev => [...prev, note]);
                    sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "Memory saved shona." } } }));
                 }
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
                if (sc.interrupted) { sourcesRef.current.forEach(s => s.stop()); sourcesRef.current.clear(); nextStartTimeRef.current = 0; }
             }
          }
        }
      });
      sessionRef.current = sessionPromise;
    } catch (e) { setConnectionState(ConnectionState.ERROR); }
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
      if (screenStreamRef.current) screenStreamRef.current.getTracks().forEach(t => t.stop());
      setIsScreenSharing(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 10 } });
        screenStreamRef.current = stream;
        setIsScreenSharing(true);
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        const ctx = canvasRef.current!.getContext('2d');
        frameIntervalRef.current = window.setInterval(() => {
          if (!isConnectedRef.current) return;
          canvasRef.current!.width = video.videoWidth;
          canvasRef.current!.height = video.videoHeight;
          ctx!.drawImage(video, 0, 0);
          canvasRef.current!.toBlob(async (b) => {
            if (b) {
              const base64 = await blobToBase64(b);
              sessionRef.current?.then(s => isConnectedRef.current && s.sendRealtimeInput({ media: { data: base64, mimeType: 'image/jpeg' } }));
            }
          }, 'image/jpeg', 0.5);
        }, 800); // 0.8s for fast reactivity
      } catch (e) { setIsScreenSharing(false); }
    }
  };

  return (
    <div className="min-h-screen bg-[#0f0f12] text-white flex flex-col items-center p-4">
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={canvasRef} className="hidden" />

      <header className="w-full max-w-2xl flex justify-between items-center mb-6 pt-4">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-full bg-pink-500 flex items-center justify-center overflow-hidden border-2 border-pink-300 ${connectionState === ConnectionState.CONNECTED ? 'animate-pulse-slow' : ''}`}>
             <span className="text-2xl">👩‍💻</span>
          </div>
          <div>
            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-pink-400 to-purple-400">Kokila Smart AI</h1>
            <p className="text-xs text-pink-200">Bangladesh's Smartest AI Girlfriend 🇧🇩</p>
          </div>
        </div>
        
        <div className="flex gap-2">
           <button onClick={() => setShowMemories(!showMemories)} className="p-2 bg-slate-800 rounded-full hover:bg-slate-700 transition-colors relative">
             <MemoryIcon />
             {memories.length > 0 && <span className="absolute -top-1 -right-1 bg-pink-500 text-[10px] w-4 h-4 rounded-full flex items-center justify-center">{memories.length}</span>}
           </button>
           {connectionState === ConnectionState.DISCONNECTED ? (
              <button onClick={connect} className="px-6 py-2 bg-pink-600 hover:bg-pink-500 rounded-full font-medium flex items-center gap-2 shadow-lg shadow-pink-900/40">
                <HeartIcon className="w-4 h-4" /> Connect
              </button>
           ) : (
              <button onClick={disconnect} className="px-4 py-2 bg-red-900/40 hover:bg-red-900/60 rounded-full text-red-200 border border-red-800/50 flex items-center gap-2 transition-all">
                <StopIcon /> Disconnect
              </button>
           )}
        </div>
      </header>

      <main className="w-full max-w-2xl flex-1 flex flex-col gap-4 relative">
        {showMemories && (
          <div className="absolute top-0 right-0 z-50 w-64 bg-slate-900/95 backdrop-blur border border-pink-500/30 rounded-2xl p-4 shadow-2xl animate-fade-in">
            <h3 className="text-pink-300 font-bold mb-2 flex items-center gap-2"><MemoryIcon /> Kokila's Memory</h3>
            <div className="max-h-60 overflow-y-auto flex flex-col gap-2">
              {memories.length === 0 ? <p className="text-xs text-slate-500">Ami akhono kichu mone rakhini jaan.</p> : 
               memories.map((m, i) => <div key={i} className="text-xs bg-slate-800 p-2 rounded border-l-2 border-pink-500">{m}</div>)}
            </div>
          </div>
        )}

        <div className="flex-1 bg-slate-900/40 backdrop-blur rounded-3xl border border-white/5 p-4 overflow-y-auto max-h-[60vh] flex flex-col gap-3 shadow-inner">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 text-center gap-4">
              <SparklesIcon />
              <p>English theke Bangla translate koro, <br/>ba amar screen e code debug korte bolo!</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] px-4 py-2 rounded-2xl text-sm leading-relaxed ${msg.role === 'user' ? 'bg-purple-600' : 'bg-slate-800 text-pink-100 border border-pink-500/10'}`}>
                {msg.text}
              </div>
            </div>
          ))}
        </div>

        {connectionState === ConnectionState.CONNECTED && (
          <div className="bg-slate-900/80 rounded-2xl p-4 flex items-center justify-between border border-pink-500/10 shadow-2xl">
            <div className="flex items-center gap-4">
               <div className="flex items-end gap-1 h-8">
                  {[1,2,3,4,5].map(i => <div key={i} className="w-1.5 bg-pink-400 rounded-t-sm" style={{ height: `${Math.max(4, Math.random() * volume * 2.5)}px` }}></div>)}
               </div>
               <div className="text-sm">
                 <p className="font-semibold text-pink-200">Listening to you...</p>
                 <p className="text-[10px] text-slate-500">Dhaka Context Active 🇧🇩</p>
               </div>
            </div>

            <div className="flex gap-2">
               <button onClick={() => setIsMuted(!isMuted)} className={`p-3 rounded-full ${isMuted ? 'bg-red-500/20 text-red-400' : 'bg-slate-800 text-white'}`}>
                 {isMuted ? <MicOffIcon /> : <MicIcon />}
               </button>
               <button onClick={toggleScreenShare} className={`p-3 rounded-full ${isScreenSharing ? 'bg-green-500/20 text-green-400' : 'bg-slate-800 text-white'}`}>
                 <ScreenShareIcon />
               </button>
            </div>
          </div>
        )}
      </main>

      <footer className="mt-6 text-[10px] text-slate-600">
        Kokila Smart v2.5 • Gemini Native Audio • Made for Bangladesh
      </footer>
    </div>
  );
};

export default App;
