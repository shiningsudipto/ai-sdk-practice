"use client";

import { useState, useRef, useCallback } from "react";

export default function VoiceAssistantPage() {
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState("Click to start");

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<AudioBufferSourceNode[]>([]);

  // Connect to WebSocket and start audio
  const startAssistant = useCallback(async () => {
    try {
      // 1. Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      // 2. Setup audio context
      const audioContext = new AudioContext({ sampleRate: 24000 });
      audioContextRef.current = audioContext;

      // 3. Connect to WebSocket
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/api/realtime`,
      );
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setStatus("Connected - Start speaking");
        nextStartTimeRef.current = 0;
        startAudioCapture(stream, audioContext, ws);
      };

      ws.onmessage = (event) => {
        handleServerMessage(event.data);
      };

      ws.onclose = () => {
        setIsConnected(false);
        setStatus("Disconnected");
        cleanup();
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        setStatus("Connection error");
      };
    } catch (error) {
      console.error("Failed to start:", error);
      setStatus("Failed to access microphone");
    }
  }, []);

  // Helper to safely convert buffer to base64
  const floatTo16BitPCM = (float32Array: Float32Array) => {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    let offset = 0;
    for (let i = 0; i < float32Array.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
  };

  const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  };

  // Stop current audio playback
  const stopAudioPlayback = () => {
    if (audioContextRef.current) {
      audioQueueRef.current.forEach((source) => {
        try {
          source.stop();
        } catch {}
      });
      audioQueueRef.current = [];
      nextStartTimeRef.current = 0;
    }
  };

  // Capture and send audio
  const startAudioCapture = async (
    stream: MediaStream,
    audioContext: AudioContext,
    ws: WebSocket,
  ) => {
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    source.connect(processor);
    processor.connect(audioContext.destination);

    processor.onaudioprocess = (e) => {
      if (ws.readyState !== WebSocket.OPEN) return;

      const inputData = e.inputBuffer.getChannelData(0);
      const pcm16Buffer = floatTo16BitPCM(inputData);
      const base64Audio = arrayBufferToBase64(pcm16Buffer);

      ws.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: base64Audio,
        }),
      );
    };

    setIsListening(true);
  };

  // Handle messages from server
  const handleServerMessage = (data: string) => {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case "session.created":
          console.log("Session created");
          break;

        case "session.updated":
          console.log("Session updated");
          break;

        case "response.audio.delta":
          console.log("Receive audio chunk");
          playAudioChunk(message.delta);
          break;

        case "response.audio.done":
          setStatus("Response complete - Continue speaking");
          break;

        case "input_audio_buffer.speech_started":
          setStatus("Listening...");
          stopAudioPlayback();
          break;

        case "input_audio_buffer.speech_stopped":
          setStatus("Processing...");
          break;

        case "response.created":
          setStatus("AI is responding...");
          break;

        case "error":
          console.error("API Error:", message.error);
          setStatus(`Error: ${message.error?.message || "Unknown error"}`);
          break;

        default:
          // Log other message types for debugging
          if (message.type) {
            console.log("Message type:", message.type);
          }
      }
    } catch {
      // Binary audio data or parse error - ignore
    }
  };

  const nextStartTimeRef = useRef<number>(0);

  // Play received audio
  const playAudioChunk = (base64Audio: string) => {
    if (!audioContextRef.current) return;

    const audioContext = audioContextRef.current;
    if (audioContext.state === "suspended") {
      audioContext.resume();
    }

    try {
      // Decode base64 to PCM
      const binaryString = atob(base64Audio);
      // Ensure even length for Int16Array
      const len = binaryString.length;
      const bytes = new Uint8Array(len % 2 === 0 ? len : len + 1);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const pcm16 = new Int16Array(bytes.buffer);

      // Convert to Float32 for Web Audio
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 0x7fff;
      }

      // Create buffer
      const buffer = audioContext.createBuffer(1, float32.length, 24000);
      buffer.getChannelData(0).set(float32);

      // Schedule playback
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);

      const currentTime = audioContext.currentTime;
      // Ensure we don't schedule in the past
      const startTime = Math.max(currentTime, nextStartTimeRef.current);

      source.start(startTime);

      // Update next start time
      nextStartTimeRef.current = startTime + buffer.duration;

      audioQueueRef.current.push(source);
    } catch (error) {
      console.error("Error playing audio:", error);
    }
  };

  // Cleanup resources
  const cleanup = () => {
    processorRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    audioContextRef.current?.close();
    audioQueueRef.current.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Ignore errors from already stopped sources
      }
    });
    audioQueueRef.current = [];
    setIsListening(false);
  };

  // Stop assistant
  const stopAssistant = () => {
    wsRef.current?.close();
    cleanup();
    setStatus("Stopped");
  };

  return (
    <div className="min-h-screen p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Voice Assistant</h1>

      <div className="flex flex-col items-center space-y-6">
        {/* Status indicator */}
        <div
          className={`w-32 h-32 rounded-full flex items-center justify-center transition-colors ${
            isListening
              ? "bg-green-500 animate-pulse"
              : isConnected
                ? "bg-yellow-500"
                : "bg-gray-300"
          }`}
        >
          <span className="text-4xl">{isListening ? "🎙️" : "🔇"}</span>
        </div>

        {/* Status text */}
        <p className="text-lg text-gray-600">{status}</p>

        {/* Control buttons */}
        <div className="flex gap-4">
          {!isConnected ? (
            <button
              onClick={startAssistant}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Start Assistant
            </button>
          ) : (
            <button
              onClick={stopAssistant}
              className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Stop Assistant
            </button>
          )}
        </div>

        {/* Instructions */}
        <div className="mt-8 p-4 bg-gray-100 rounded-lg text-sm text-gray-600">
          <h3 className="font-semibold mb-2">How to use:</h3>
          <ol className="list-decimal list-inside space-y-1">
            <li>Click "Start Assistant" to connect</li>
            <li>Allow microphone access when prompted</li>
            <li>Start speaking naturally</li>
            <li>The AI will respond with voice</li>
          </ol>
        </div>

        {/* Note about custom server */}
        <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
          <p className="font-semibold">Note:</p>
          <p>
            Run{" "}
            <code className="bg-yellow-100 px-1 rounded">npm run dev:ws</code>{" "}
            instead of{" "}
            <code className="bg-yellow-100 px-1 rounded">npm run dev</code> to
            enable WebSocket support.
          </p>
        </div>
      </div>
    </div>
  );
}
