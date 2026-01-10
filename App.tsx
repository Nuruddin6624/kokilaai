import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ConnectionState, Message, KOKILA_SYSTEM_INSTRUCTION } from './types';
import { decodeAudioData, createBlob, blobToBase64 } from './utils/audio';

const App: React.FC = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0);
  const [memories, setMemories] = useState<string[]>([]);
  const [showMemories, setShowMemories] = useState(false);
  const [virtualPointer, setVirtualPointer] = useState<{ x: number; y: number; label: string } | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameIntervalRef = useRef<number | null>(null);
  const sessionRef = useRef<any>(null);
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
      try { sessionRef.current.close(); } catch (e) {}
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
      
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
      
      inputAudioContextRef.current = new AudioContext({ sampleRate: 16000 });
      outputAudioContextRef.current = new AudioContext({ sampleRate: 24000 });

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const session = await ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          systemInstruction: KOKILA_SYSTEM_INSTRUCTION + `\n\nMEMORY:\n${memories.join('\n')}`,
          responseModalities: ['AUDIO'],
          speechConfig: { 
            voiceConfig: { 
              prebuiltVoiceConfig: { 
                voiceName: 'Kore',
                speakingRate: 1.3  // ⚡ ULTRA FAST VOICE
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
            setMessages(p => [...p, { role: 'model', text: "⚡ Jaan! LIGHTNING MODE ON!", timestamp: new Date() }]);
            
            // ⚡ ULTRA-FAST SILENCE (1.2s)
            silenceIntervalRef.current = window.setInterval(() => {
              if (!isConnectedRef.current) return;
              if (Date.now() - lastActivityTimeRef.current > 1200) {
                session.sendRealtimeInput({ 
                  text: "[⚡ LIGHTNING: Screen scan + clickAt NOW!]" 
                });
                updateActivityTime();
              }
            }, 300);
            
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
              session.sendRealtimeInput({ media: createBlob(inputData) });
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContextRef.current!.destination);
          },
          onmessage: async (msg: any) => {
            if (!isConnectedRef.current) return;
            updateActivityTime();

            if (msg.toolCall) {
              for (const fc of msg.toolCall.functionCalls) {
                if (fc.name === 'clickAt') {
                  const { x, y, label } = fc.args;
                  setVirtualPointer({ x, y, label });
                  setTimeout(() => setVirtualPointer(null), 3500);
                }
              }
            }

            const audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audio && outputAudioContextRef.current) {
              const ctx = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const buffer = await decodeAudioData(audio, ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(ctx.destination);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              sourcesRef.current.add(source);
            }
          },
          onerror: () => { setConnectionState(ConnectionState.ERROR); cleanup(); },
          onclose: () => cleanup()
        }
      });
      sessionRef.current = session;
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
          video: { frameRate: { ideal: 20, max: 30 } } 
        });
        screenStreamRef.current = stream;
        setIsScreenSharing(true);
        setIsScanning(true);
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        const ctx = canvasRef.current!.getContext('2d')!;
        
        // ⚡ 200ms ULTRA FAST
        frameIntervalRef.current = window.setInterval(() => {
          if (!isConnectedRef.current || !sessionRef.current) return;
          canvasRef.current!.width = video.videoWidth;
          canvasRef.current!.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          canvasRef.current!.toBlob(async (b) => {
            if (b && isConnectedRef.current) {
              const base64 = await blobToBase64(b);
              sessionRef.current.sendRealtimeInput({ 
                media: { data: base64, mimeType: 'image/jpeg' } 
              });
            }
          }, 'image/jpeg', 0.5);
        }, 200); // ⚡ LIGHTNING!
      } catch (e) { 
        console.error(e);
        setIsScreenSharing(false); 
        setIsScanning(false); 
      }
    }
  };

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

      {virtualPointer && (
        <div 
          className="absolute z-[100] pointer-events-none transition-all duration-300 ease-in-out animate-pulse"
          style={{ left: `${virtualPointer.x}%`, top: `${virtualPointer.y}%`, transform: 'translate(-50%, -50%)' }}
        >
          <div className="w-28 h-28 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center shadow-[0_0_80px_rgba(219,39,119,1)] border-4 border-white/50 animate-heartbeat">
            ❤️
          </div>
        </div>
      )}

      <header className="w-full max-w-3xl flex justify-between items-center mb-12 pt-8 px-6">
        <div className="flex items-center gap-8">
          <div className={`w-28 h-28 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center border-4 border-white/20 shadow-[0_0_60px_rgba(219,39,119,0.8)] ${isScanning ? 'animate-ping' : ''}`}>
            🧕
          </div>
          <div>
            <h1 className="text-4xl font-black bg-gradient-to-r from-pink-400 to-purple-500 bg-clip-text text-transparent">Kokila Elite</h1>
            <p className="text-sm text-pink-300 font-bold uppercase tracking-wider">⚡ 200ms Lightning</p>
          </div>
        </div>
        <button onClick={connectionState === ConnectionState.CONNECTED ? cleanup : connect} className="px-8 py-3 bg-pink-600 hover:bg-pink-500 rounded-full font-bold text-sm">
          {connectionState === ConnectionState.CONNECTED ? 'Disconnect' : 'Connect'}
        </button>
      </header>

      <main className="w-full max-w-3xl flex-1 flex flex-col gap-8 px-6">
        <div className="flex-1 bg-slate-900/50 backdrop-blur-xl rounded-3xl p-8 overflow-y-auto max-h-[40vh] border border-white/10">
          {messages.map((msg, i) => (
            <div key={i} className={`mb-4 p-4 rounded-2xl ${msg.role === 'model' ? 'bg-pink-500/20 border-pink-500/30' : 'bg-slate-800 ml-auto'}`}>
              <p className="text-sm">{msg.text}</p>
            </div>
          ))}
        </div>

        {connectionState === ConnectionState.CONNECTED && (
          <div className="bg-slate-900/90 backdrop-blur-xl rounded-3xl p-8 flex items-center justify-between border border-white/20">
            <div className="flex items-center gap-6 h-20">
              <div className="flex items-end gap-2 h-16">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="w-2 bg-pink-500 rounded-full transition-all" style={{ height: `${Math.max(8, Math.random() * volume * 4)}px` }} />
                ))}
              </div>
              <span className="text-xs font-bold text-pink-300 uppercase tracking-wider">Lightning Mode ⚡</span>
            </div>
            <div className="flex gap-4">
              <button onClick={() => setIsMuted(!isMuted)} className={`p-4 rounded-2xl ${isMuted ? 'bg-red-500/20 text-red-400' : 'bg-slate-800 text-white'}`}>
                {isMuted ? '🔇' : '🎤'}
              </button>
              <button onClick={toggleScreen} className={`p-4 rounded-2xl ${isScreenSharing ? 'bg-green-500/20 text-green-400' : 'bg-slate-800 text-white'}`}>
                📱
              </button>
            </div>
          </div>
        )}
      </main>

      <style jsx>{`
        @keyframes heartbeat {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.2); }
        }
        .animate-heartbeat { animation: heartbeat 1s infinite; }
        .animate-ping { animation: ping 1s infinite; }
      `}</style>
    </div>
  );
};

export default App;
