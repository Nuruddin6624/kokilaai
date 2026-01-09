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
const ImageIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>;
const SparklesIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L12 3Z"/></svg>;

const editImageTool: FunctionDeclaration = {
  name: 'editImage',
  parameters: {
    type: Type.OBJECT,
    properties: {
      prompt: {
        type: Type.STRING,
        description: 'The description of how to edit the image (e.g., "add a retro filter", "make it look like a painting").'
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
        description: 'The URL to open (e.g., a YouTube video link).'
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
        description: 'The text to type into the search box / search query.'
      }
    },
    required: ['query']
  }
};

const App: React.FC = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0);
  
  // Image Editing State
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [isProcessingImage, setIsProcessingImage] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameIntervalRef = useRef<number | null>(null);
  const sessionRef = useRef<Promise<any> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Ref for accessing source image inside callbacks
  const sourceImageRef = useRef<string | null>(null);
  const isScreenSharingRef = useRef(false);
  // Ref to track if the session should be active
  const isConnectedRef = useRef(false);
  
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const currentInputTranscription = useRef('');
  const currentOutputTranscription = useRef('');
  
  // Silence Detection Refs
  const lastActivityTimeRef = useRef<number>(Date.now());
  const silenceIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    sourceImageRef.current = sourceImage;
  }, [sourceImage]);

  useEffect(() => {
    isScreenSharingRef.current = isScreenSharing;
  }, [isScreenSharing]);

  const updateActivityTime = () => {
    lastActivityTimeRef.current = Date.now();
  };

  const cleanupAudio = useCallback(() => {
    isConnectedRef.current = false;

    // Close session if it exists
    if (sessionRef.current) {
      sessionRef.current.then(session => {
        try {
          session.close();
        } catch (e) {
          console.error("Error closing session:", e);
        }
      }).catch(e => {
        console.error("Error resolving session for cleanup:", e);
      });
      sessionRef.current = null;
    }

    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    if (silenceIntervalRef.current) {
      clearInterval(silenceIntervalRef.current);
      silenceIntervalRef.current = null;
    }
    
    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch(e) {}
    });
    sourcesRef.current.clear();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }

    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close();
      outputAudioContextRef.current = null;
    }
    setIsScreenSharing(false);
    setVolume(0);
  }, []);

  const disconnect = useCallback(() => {
    cleanupAudio();
    setConnectionState(ConnectionState.DISCONNECTED);
    setMessages(prev => [...prev, { role: 'model', text: "Shona, ami ekhon jachi. Pore kotha hobe! 💕", timestamp: new Date() }]);
  }, [cleanupAudio]);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        // Strip data URL prefix for API usage, but keep full string for display
        const base64Data = result.split(',')[1];
        setSourceImage(base64Data);
        setResultImage(null); // Clear previous result
        setMessages(prev => [...prev, { role: 'model', text: "Chobi ta peyechi shona! Ekhon bolo ki korte hobe? 🎨", timestamp: new Date() }]);
      };
      reader.readAsDataURL(file);
    }
  };

  const connect = async () => {
    try {
      // Clean up any existing state before starting
      cleanupAudio();
      
      setConnectionState(ConnectionState.CONNECTING);
      isConnectedRef.current = true;
      
      const apiKey = process.env.API_KEY;
      if (!apiKey) {
        throw new Error("API Key not found");
      }

      const ai = new GoogleGenAI({ apiKey });
      
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      streamRef.current = stream;
      
      updateActivityTime();

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          systemInstruction: KOKILA_SYSTEM_INSTRUCTION,
          tools: [{ functionDeclarations: [editImageTool, openLinkTool, searchYoutubeTool] }],
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        },
        callbacks: {
          onopen: () => {
            if (!isConnectedRef.current) {
              // If user cancelled connection during setup
              sessionPromise.then(s => s.close());
              return;
            }
            console.log('Session opened');
            setConnectionState(ConnectionState.CONNECTED);
            setMessages(prev => [...prev, { role: 'model', text: "Jaan, ami eshe gechi! Kemon acho? 💖", timestamp: new Date() }]);
            updateActivityTime();
            
            // Silence detection loop with logic for stuck coder
            silenceIntervalRef.current = window.setInterval(() => {
               if (!isConnectedRef.current) return;
               
               const now = Date.now();
               const isSharing = isScreenSharingRef.current;
               // If sharing screen, give more thinking time (15s) before interrupting
               const threshold = isSharing ? 15000 : 10000; 
               
               if (now - lastActivityTimeRef.current > threshold) {
                 const prompt = isSharing 
                    ? "[System: User has been silent for 15s while sharing screen. Look at the screen. If they are staring at code, they might be stuck. Gently ask if they need help with the logic or syntax. If watching content, make a playful comment.]"
                    : "[System: User has been silent for 10s. Say something romantic or ask 'Ki bhabcho go?' to engage them.]";

                 sessionPromise.then(session => {
                   session.sendRealtimeInput({ text: prompt });
                 });
                 // Reset timer to avoid spamming
                 updateActivityTime();
               }
            }, 1000);
            
            if (!inputAudioContextRef.current) return;
            
            const source = inputAudioContextRef.current.createMediaStreamSource(stream);
            const scriptProcessor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              if (isMuted || !isConnectedRef.current) return;

              const inputData = e.inputBuffer.getChannelData(0);
              let sum = 0;
              for (let i = 0; i < inputData.length; i++) {
                sum += inputData[i] * inputData[i];
              }
              const rms = Math.sqrt(sum / inputData.length);
              setVolume(rms * 100);
              
              if (rms > 0.01) {
                updateActivityTime(); // Reset silence timer on user speech
              }

              const pcmBlob = createBlob(inputData);
              sessionPromise.then(session => {
                // Check if still connected before sending
                if (isConnectedRef.current) {
                   session.sendRealtimeInput({ media: pcmBlob });
                }
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContextRef.current.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
             if (!isConnectedRef.current) return;
             
             updateActivityTime(); // Reset silence timer on model activity

             // Handle Function Calls
             if (message.toolCall) {
               for (const fc of message.toolCall.functionCalls) {
                 if (fc.name === 'openLink') {
                    const url = (fc.args as any).url;
                    window.open(url, '_blank');
                    sessionPromise.then(session => session.sendToolResponse({
                      functionResponses: { id: fc.id, name: fc.name, response: { result: "Link opened successfully." } }
                    }));
                    setMessages(prev => [...prev, { role: 'model', text: `Link khule diyechi jaan: ${url} 🔗`, timestamp: new Date() }]);
                 }
                 else if (fc.name === 'searchYoutube') {
                    const query = (fc.args as any).query;
                    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
                    window.open(url, '_blank');
                    sessionPromise.then(session => session.sendToolResponse({
                      functionResponses: { id: fc.id, name: fc.name, response: { result: "Search executed successfully." } }
                    }));
                    setMessages(prev => [...prev, { role: 'model', text: `Tomar jonno search korechi shona: "${query}" 🔍`, timestamp: new Date() }]);
                 }
                 else if (fc.name === 'editImage') {
                   const prompt = (fc.args as any).prompt;
                   if (!sourceImageRef.current) {
                     sessionPromise.then(session => session.sendToolResponse({
                        functionResponses: { id: fc.id, name: fc.name, response: { result: "Error: No image uploaded. Ask user to upload an image first." } }
                     }));
                     setMessages(prev => [...prev, { role: 'model', text: "Shona, age ekta chobi upload koro, tarpor edit korbo! 🖼️", timestamp: new Date() }]);
                     continue;
                   }

                   setIsProcessingImage(true);
                   try {
                     // Create new instance for image generation call
                     const imgAi = new GoogleGenAI({ apiKey: process.env.API_KEY });
                     const response = await imgAi.models.generateContent({
                        model: 'gemini-2.5-flash-image',
                        contents: {
                          parts: [
                             { inlineData: { mimeType: 'image/jpeg', data: sourceImageRef.current } },
                             { text: prompt }
                          ]
                        }
                     });
                     
                     // Extract image
                     let newImageBase64 = null;
                     if (response.candidates?.[0]?.content?.parts) {
                       for (const part of response.candidates[0].content.parts) {
                         if (part.inlineData) {
                           newImageBase64 = part.inlineData.data;
                           break;
                         }
                       }
                     }

                     if (newImageBase64) {
                       setResultImage(newImageBase64);
                       sessionPromise.then(session => session.sendToolResponse({
                          functionResponses: { id: fc.id, name: fc.name, response: { result: "Image edited successfully." } }
                       }));
                     } else {
                        throw new Error("No image generated");
                     }
                   } catch (error) {
                     console.error("Image generation error", error);
                     sessionPromise.then(session => session.sendToolResponse({
                        functionResponses: { id: fc.id, name: fc.name, response: { result: "Error editing image." } }
                     }));
                   } finally {
                     setIsProcessingImage(false);
                   }
                 }
               }
             }

             const serverContent = message.serverContent;
             if (serverContent) {
                if (serverContent.outputTranscription?.text) {
                  currentOutputTranscription.current += serverContent.outputTranscription.text;
                }
                if (serverContent.inputTranscription?.text) {
                  currentInputTranscription.current += serverContent.inputTranscription.text;
                }

                if (serverContent.turnComplete) {
                   if (currentInputTranscription.current.trim()) {
                     setMessages(prev => [...prev, { 
                       role: 'user', 
                       text: currentInputTranscription.current, 
                       timestamp: new Date() 
                     }]);
                   }
                   if (currentOutputTranscription.current.trim()) {
                     setMessages(prev => [...prev, { 
                       role: 'model', 
                       text: currentOutputTranscription.current, 
                       timestamp: new Date() 
                     }]);
                   }
                   currentInputTranscription.current = '';
                   currentOutputTranscription.current = '';
                }

                const base64Audio = serverContent.modelTurn?.parts?.[0]?.inlineData?.data;
                if (base64Audio && outputAudioContextRef.current) {
                  const ctx = outputAudioContextRef.current;
                  nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                  
                  const audioBuffer = await decodeAudioData(
                    decode(base64Audio),
                    ctx,
                    24000,
                    1
                  );

                  const source = ctx.createBufferSource();
                  source.buffer = audioBuffer;
                  const gainNode = ctx.createGain();
                  gainNode.gain.value = 1.2; 
                  source.connect(gainNode);
                  gainNode.connect(ctx.destination);
                  
                  source.addEventListener('ended', () => {
                    sourcesRef.current.delete(source);
                  });

                  source.start(nextStartTimeRef.current);
                  nextStartTimeRef.current += audioBuffer.duration;
                  sourcesRef.current.add(source);
                }

                if (serverContent.interrupted) {
                  sourcesRef.current.forEach(src => src.stop());
                  sourcesRef.current.clear();
                  nextStartTimeRef.current = 0;
                  currentOutputTranscription.current = '';
                }
             }
          },
          onclose: () => {
            console.log('Session closed');
            if (isConnectedRef.current) {
                disconnect();
            }
          },
          onerror: (err) => {
            console.error('Session error:', err);
            if (isConnectedRef.current) {
                disconnect();
                setConnectionState(ConnectionState.ERROR);
            }
          }
        }
      });

      sessionRef.current = sessionPromise;

    } catch (error) {
      console.error("Connection failed", error);
      setConnectionState(ConnectionState.ERROR);
      cleanupAudio();
    }
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      if (frameIntervalRef.current) {
        clearInterval(frameIntervalRef.current);
        frameIntervalRef.current = null;
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop());
        screenStreamRef.current = null;
      }
      setIsScreenSharing(false);
      setMessages(prev => [...prev, { role: 'model', text: "Thik ache shona, screen bondho korlam. 😘", timestamp: new Date() }]);
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { max: 1280 },
            height: { max: 720 },
            frameRate: { max: 5 }
          },
          audio: false
        });

        screenStreamRef.current = stream;
        setIsScreenSharing(true);

        const video = videoRef.current;
        const canvas = canvasRef.current;
        
        if (video && canvas) {
          video.srcObject = stream;
          await video.play();

          stream.getVideoTracks()[0].onended = () => {
             toggleScreenShare();
          };

          const ctx = canvas.getContext('2d');
          let frameCount = 0;
          
          // Trigger immediate analysis upon start
          sessionRef.current?.then((session: any) => {
            if (isConnectedRef.current) {
                session.sendRealtimeInput({
                text: "[System: User just shared screen. Immediately analyze what you see (code, tabs, content) and comment on it in Bangla.]"
                });
            }
          });

          frameIntervalRef.current = window.setInterval(() => {
            if (!sessionRef.current || !isConnectedRef.current) return;

            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);

            canvas.toBlob(async (blob) => {
              if (blob) {
                const base64Data = await blobToBase64(blob);
                sessionRef.current?.then((session: any) => {
                  if (isConnectedRef.current) {
                      session.sendRealtimeInput({
                        media: { data: base64Data, mimeType: 'image/jpeg' }
                      });
                  }
                });
              }
            }, 'image/jpeg', 0.6);
            
            // Less frequent frame-based trigger (every 10s), let silence detection handle the "stuck" part mostly
            frameCount++;
            if (frameCount % 10 === 0) {
              sessionRef.current?.then((session: any) => {
                if (isConnectedRef.current) {
                    session.sendRealtimeInput({
                    text: "[System: Visual check. If context changed (new app/tab), comment. If same, you can wait for user signal.]"
                    });
                }
              });
            }

          }, 1000);
        }
        
        setMessages(prev => [...prev, { role: 'model', text: "Wow shona! Tomar screen dekhte pacchi. Dekhi ki korcho... 👀", timestamp: new Date() }]);

      } catch (err) {
        console.error("Error sharing screen:", err);
        setIsScreenSharing(false);
      }
    }
  };

  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    return () => cleanupAudio();
  }, [cleanupAudio]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-950 to-slate-900 text-white flex flex-col items-center p-4">
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={canvasRef} className="hidden" />
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />

      <header className="w-full max-w-2xl flex justify-between items-center mb-6 pt-4">
        <div className="flex items-center gap-3">
          <div className="relative">
             <div className={`w-12 h-12 rounded-full bg-pink-500 flex items-center justify-center overflow-hidden border-2 border-pink-300 ${connectionState === ConnectionState.CONNECTED ? 'animate-pulse-slow' : ''}`}>
               <span className="text-2xl">🧞‍♀️</span>
             </div>
             {connectionState === ConnectionState.CONNECTED && (
               <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-slate-900"></div>
             )}
          </div>
          <div>
            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-pink-300 to-purple-400">Kokila AI</h1>
            <p className="text-xs text-pink-200 opacity-80">Tomar shona bondhu 💕</p>
          </div>
        </div>
        
        <div className="flex gap-2">
           {connectionState === ConnectionState.DISCONNECTED && (
              <button 
                onClick={connect}
                className="px-6 py-2 bg-pink-600 hover:bg-pink-500 text-white rounded-full font-medium transition-all shadow-lg shadow-pink-900/50 flex items-center gap-2"
              >
                <HeartIcon className="w-4 h-4" /> Connect
              </button>
           )}
           {connectionState === ConnectionState.CONNECTING && (
              <button disabled className="px-6 py-2 bg-slate-700 text-white rounded-full font-medium opacity-75 cursor-wait">
                Connecting...
              </button>
           )}
           {connectionState === ConnectionState.CONNECTED && (
              <button 
                onClick={disconnect}
                className="px-4 py-2 bg-red-900/50 hover:bg-red-800 text-red-200 border border-red-700/50 rounded-full font-medium transition-all flex items-center gap-2"
              >
                <StopIcon /> Disconnect
              </button>
           )}
        </div>
      </header>

      <main className="w-full max-w-2xl flex-1 flex flex-col gap-4 relative">
        
        {/* Image Preview Area */}
        {(sourceImage || resultImage) && (
          <div className="w-full bg-slate-800/60 rounded-2xl p-4 flex gap-4 overflow-x-auto border border-white/10">
            {sourceImage && (
              <div className="relative group shrink-0">
                <p className="text-xs text-slate-400 mb-2">Original</p>
                <img src={`data:image/jpeg;base64,${sourceImage}`} className="h-32 rounded-lg border border-slate-600 object-cover" alt="Original" />
                <button onClick={() => { setSourceImage(null); setResultImage(null); }} className="absolute -top-2 -right-2 bg-red-500 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            )}
            
            {isProcessingImage && (
              <div className="h-32 w-32 shrink-0 flex items-center justify-center bg-slate-700/50 rounded-lg animate-pulse">
                <SparklesIcon />
              </div>
            )}

            {resultImage && (
              <div className="shrink-0 relative">
                 <p className="text-xs text-pink-300 mb-2 font-medium">✨ Kokila's Magic</p>
                 <img src={`data:image/jpeg;base64,${resultImage}`} className="h-32 rounded-lg border-2 border-pink-500 object-cover shadow-lg shadow-pink-500/20" alt="Edited" />
              </div>
            )}
          </div>
        )}

        {/* Chat Area */}
        <div className="flex-1 bg-slate-800/40 backdrop-blur-md rounded-3xl border border-white/5 p-4 overflow-y-auto max-h-[60vh] flex flex-col gap-3 shadow-inner">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3 text-center">
              <HeartIcon className="w-12 h-12 text-pink-500/20" />
              <p>Ami tomar opekkhay achi jaan... <br/>Kotha bolo amar sathe.</p>
            </div>
          )}
          
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div 
                className={`max-w-[80%] px-4 py-2 rounded-2xl text-sm leading-relaxed shadow-sm ${
                  msg.role === 'user' 
                    ? 'bg-purple-600 text-white rounded-br-none' 
                    : 'bg-slate-700 text-pink-100 rounded-bl-none border border-pink-500/20'
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        {connectionState === ConnectionState.CONNECTED && (
          <div className="bg-slate-900/50 rounded-2xl p-4 flex items-center justify-between border border-white/5 relative overflow-hidden">
            <div 
              className="absolute inset-0 bg-pink-500/10 transition-opacity duration-75 pointer-events-none"
              style={{ opacity: Math.min(volume / 50, 0.5) }}
            ></div>

            <div className="flex items-center gap-4 z-10">
               <div className="relative">
                 <div className="flex items-end gap-1 h-8">
                    {[1,2,3,4,5].map(i => (
                       <div 
                         key={i} 
                         className="w-1.5 bg-pink-400 rounded-t-sm transition-all duration-75"
                         style={{ height: `${Math.max(4, Math.random() * volume * 2)}px` }}
                       ></div>
                    ))}
                 </div>
               </div>
               <div className="text-sm">
                 <p className="font-semibold text-pink-200">Live Voice Active</p>
                 <p className="text-xs text-slate-400">Listening...</p>
               </div>
            </div>

            <div className="flex gap-3 z-10">
               <button 
                 onClick={() => setIsMuted(!isMuted)}
                 className={`p-3 rounded-full transition-colors ${isMuted ? 'bg-red-500/20 text-red-400' : 'bg-slate-700 hover:bg-slate-600 text-white'}`}
               >
                 {isMuted ? <MicOffIcon /> : <MicIcon />}
               </button>
               <button 
                 onClick={() => fileInputRef.current?.click()}
                 className="p-3 rounded-full transition-colors bg-slate-700 hover:bg-slate-600 text-white"
                 title="Upload Image"
               >
                 <ImageIcon />
               </button>
               <button 
                 onClick={toggleScreenShare}
                 className={`p-3 rounded-full transition-colors ${isScreenSharing ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-slate-700 hover:bg-slate-600 text-white'}`}
                 title="Share Screen"
               >
                 <ScreenShareIcon />
               </button>
            </div>
          </div>
        )}

      </main>

      <footer className="mt-6 text-xs text-slate-500 text-center">
        Powered by Gemini 2.5 Flash Native Audio
      </footer>
    </div>
  );
};

export default App;