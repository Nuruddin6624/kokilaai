export async function decodeAudioData(audioData: Uint8Array, ctx: AudioContext, sampleRate: number, channels: number) {
  const pcmData = decode(audioData);
  const buffer = ctx.createBuffer(channels, pcmData.length / channels, sampleRate);
  for (let ch = 0; ch < channels; ch++) {
    const channelData = buffer.getChannelData(ch);
    for (let i = 0; i < channelData.length; i++) {
      channelData[i] = pcmData[ch + i * channels] / 32768;
    }
  }
  return buffer;
}

export function createBlob(inputData: Float32Array) {
  const pcmData = new Int16Array(inputData.length);
  for (let i = 0; i < inputData.length; i++) {
    pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
  }
  return new Blob([pcmData.buffer], { type: 'audio/pcm;bits=16;rate=16000;channels=1' });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(blob);
  });
}

const decode = (encoded: Uint8Array): Int16Array => {
  const decoded = new Int16Array(encoded.length);
  for (let i = 0; i < encoded.length; i += 2) {
    decoded[i / 2] = (encoded[i + 1] << 8) | encoded[i];
  }
  return decoded;
};

export { decode };
