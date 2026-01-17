# Realtime AI Voice Assistant - Implementation Guide

Build a real-time voice assistant in Next.js using OpenAI's Realtime API.

---

## Overview

**What we're building:**

- User speaks → AI listens in real-time → AI responds with voice instantly

**Tech Stack:**

- Next.js (App Router)
- Web Audio API (microphone capture)
- WebSocket (bidirectional streaming)
- OpenAI Realtime API

---

## Architecture

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Browser   │────▶│  Next.js Server │────▶│  OpenAI Realtime│
│  (Mic/Audio)│◀────│    (Relay)      │◀────│      API        │
└─────────────┘     └─────────────────┘     └─────────────────┘
     WebSocket           WebSocket
```

---

## Step 1: Project Setup

### 1.1 Install Dependencies

```bash
npm install ws
npm install -D @types/ws
```

### 1.2 Environment Variables

```env
OPENAI_API_KEY=sk-your-api-key
```

---

## Step 2: Create WebSocket Server Route

Create `app/api/realtime/route.ts`:

```ts
import { WebSocketServer, WebSocket } from "ws";

// Store the WebSocket server instance
let wss: WebSocketServer | null = null;

export async function GET(req: Request) {
  // This endpoint returns connection info
  // Actual WebSocket upgrade happens in middleware or custom server
  return Response.json({
    message: "WebSocket endpoint. Connect via ws://localhost:3000/api/realtime",
  });
}
```

> **Note:** Next.js App Router doesn't natively support WebSocket upgrades.
> You'll need a custom server setup (see Step 2B below).

### 2B: Custom Server for WebSocket (server.ts)

Create `server.ts` in project root:

```ts
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res, parse(req.url!, true));
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url!, true);

    if (pathname === "/api/realtime") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        handleRealtimeConnection(ws);
      });
    }
  });

  function handleRealtimeConnection(clientWs: WebSocket) {
    // Connect to OpenAI Realtime API
    const openaiWs = new WebSocket(
      "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01",
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "OpenAI-Beta": "realtime=v1",
        },
      },
    );

    openaiWs.on("open", () => {
      // Configure session
      openaiWs.send(
        JSON.stringify({
          type: "session.update",
          session: {
            modalities: ["text", "audio"],
            instructions:
              "You are a helpful voice assistant. Keep responses brief.",
            voice: "alloy",
            input_audio_format: "pcm16",
            output_audio_format: "pcm16",
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
            },
          },
        }),
      );
    });

    // Relay messages: Client → OpenAI
    clientWs.on("message", (data) => {
      if (openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.send(data);
      }
    });

    // Relay messages: OpenAI → Client
    openaiWs.on("message", (data) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data);
      }
    });

    // Cleanup on close
    clientWs.on("close", () => openaiWs.close());
    openaiWs.on("close", () => clientWs.close());
  }

  server.listen(3000, () => {
    console.log("> Ready on http://localhost:3000");
  });
});
```

Update `package.json`:

```json
{
  "scripts": {
    "dev": "ts-node --project tsconfig.server.json server.ts",
    "build": "next build",
    "start": "NODE_ENV=production ts-node server.ts"
  }
}
```

---

## Step 3: Create Voice Assistant UI

Create `app/voice-assistant/page.tsx`:

```tsx
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
      const ws = new WebSocket(`ws://${window.location.host}/api/realtime`);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setStatus("Connected - Start speaking");
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

  // Capture and send audio
  const startAudioCapture = (
    stream: MediaStream,
    audioContext: AudioContext,
    ws: WebSocket,
  ) => {
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    source.connect(processor);
    processor.connect(audioContext.destination);

    processor.onaudioprocess = (e) => {
      if (ws.readyState !== WebSocket.OPEN) return;

      const inputData = e.inputBuffer.getChannelData(0);

      // Convert Float32 to Int16 PCM
      const pcm16 = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      // Send as base64 encoded audio
      const base64Audio = btoa(
        String.fromCharCode(...new Uint8Array(pcm16.buffer)),
      );

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
        case "response.audio.delta":
          // Play audio chunk
          playAudioChunk(message.delta);
          break;

        case "response.audio.done":
          setStatus("Response complete");
          break;

        case "input_audio_buffer.speech_started":
          setStatus("Listening...");
          break;

        case "input_audio_buffer.speech_stopped":
          setStatus("Processing...");
          break;

        case "error":
          console.error("API Error:", message.error);
          setStatus(`Error: ${message.error.message}`);
          break;
      }
    } catch (error) {
      // Binary audio data - handle separately if needed
    }
  };

  // Play received audio
  const playAudioChunk = (base64Audio: string) => {
    if (!audioContextRef.current) return;

    const audioContext = audioContextRef.current;

    // Decode base64 to PCM
    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const pcm16 = new Int16Array(bytes.buffer);

    // Convert to Float32 for Web Audio
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 0x7fff;
    }

    // Create and play buffer
    const buffer = audioContext.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start();
  };

  // Cleanup resources
  const cleanup = () => {
    processorRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    audioContextRef.current?.close();
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
          className={`w-32 h-32 rounded-full flex items-center justify-center ${
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
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Start Assistant
            </button>
          ) : (
            <button
              onClick={stopAssistant}
              className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700"
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
      </div>
    </div>
  );
}
```

---

## Step 4: Configure Next.js

Update `next.config.ts` for WebSocket and audio:

```ts
const nextConfig = {
  // Allow audio data URLs
  images: {
    dangerouslyAllowSVG: true,
  },
  // Required for custom server
  output: "standalone",
};

export default nextConfig;
```

---

## Step 5: Run the Application

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

Visit `http://localhost:3000/voice-assistant` to test.

---

## Key Concepts

### Audio Format

- **Input:** PCM 16-bit, 24kHz, mono
- **Output:** PCM 16-bit, 24kHz, mono
- **Encoding:** Base64 for JSON transport

### Voice Activity Detection (VAD)

The OpenAI Realtime API has built-in VAD:

- `server_vad`: Server detects when user stops speaking
- `threshold`: Sensitivity (0.0-1.0)
- `silence_duration_ms`: How long to wait before processing

### Session Configuration Options

```ts
{
  modalities: ["text", "audio"],  // or just ["audio"]
  voice: "alloy",                 // alloy, echo, fable, onyx, nova, shimmer
  instructions: "...",            // System prompt
  input_audio_format: "pcm16",
  output_audio_format: "pcm16",
  turn_detection: { ... }
}
```

---

## Troubleshooting

| Issue                   | Solution                                           |
| ----------------------- | -------------------------------------------------- |
| No microphone access    | Check browser permissions, use HTTPS in production |
| WebSocket won't connect | Ensure custom server is running, check firewall    |
| Audio choppy            | Reduce buffer size, check network latency          |
| Echo/feedback           | Enable echo cancellation in getUserMedia           |
| High latency            | Use closer server region, reduce audio quality     |

---

## Cost Considerations

OpenAI Realtime API pricing (as of 2024):

- **Audio input:** $0.06 / minute
- **Audio output:** $0.24 / minute
- **Text input/output:** Standard GPT-4 pricing

---

## Next Steps

1. Add conversation history display
2. Add visual audio waveform
3. Support multiple languages
4. Add function calling for actions
