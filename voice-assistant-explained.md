# Voice Assistant - Code Explanation Guide

This guide explains how the real-time voice assistant works, breaking down both the server-side WebSocket relay and the client-side audio handling.

---

## Architecture Overview

```
┌──────────────────────┐      ┌────────────────────┐      ┌─────────────────────┐
│      Browser         │      │   Custom Server    │      │  OpenAI Realtime    │
│  (page.tsx)          │      │   (server.ts)      │      │       API           │
│                      │      │                    │      │                     │
│  ┌────────────────┐  │      │                    │      │                     │
│  │ Microphone     │──┼──────┼──► Relay ──────────┼──────┼──►                  │
│  │ (PCM16 Audio)  │  │  WS  │                    │  WS  │                     │
│  └────────────────┘  │      │                    │      │                     │
│                      │      │                    │      │                     │
│  ┌────────────────┐  │      │                    │      │                     │
│  │ Speaker        │◄─┼──────┼──◄ Relay ◄─────────┼──────┼──◄                  │
│  │ (Audio Output) │  │      │                    │      │                     │
│  └────────────────┘  │      │                    │      │                     │
└──────────────────────┘      └────────────────────┘      └─────────────────────┘
```

**Why a relay server?**
- OpenAI Realtime API requires an API key in headers
- Browser WebSocket cannot set custom headers
- Server acts as a secure proxy, hiding the API key

---

## Part 1: Server-Side (server.ts)

### 1.1 Why Custom Server?

Next.js App Router doesn't support WebSocket upgrades natively. We need a custom HTTP server that can:
1. Handle normal HTTP requests (Next.js pages)
2. Handle WebSocket upgrade requests

### 1.2 Server Setup (Lines 1-13)

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
```

**What's happening:**
1. `next({ dev })` - Initialize Next.js app
2. `app.prepare()` - Wait for Next.js to compile
3. `createServer()` - Create HTTP server
4. `handle(req, res, ...)` - Let Next.js handle all HTTP requests

### 1.3 WebSocket Server Setup (Lines 15-25)

```ts
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const { pathname } = parse(req.url!, true);

  if (pathname === "/api/realtime") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleRealtimeConnection(ws);
    });
  }
});
```

**What's happening:**
1. `noServer: true` - WebSocket server won't listen on its own port
2. `server.on("upgrade")` - Listen for WebSocket upgrade requests
3. Only handle upgrades to `/api/realtime` path
4. `handleUpgrade()` - Complete the WebSocket handshake
5. Call `handleRealtimeConnection()` with the new WebSocket

**HTTP Upgrade Process:**
```
Browser Request:
GET /api/realtime HTTP/1.1
Upgrade: websocket
Connection: Upgrade

Server Response:
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
```

### 1.4 Connecting to OpenAI (Lines 27-39)

```ts
function handleRealtimeConnection(clientWs: WebSocket) {
  console.log("Client connected to realtime");

  const openaiWs = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview",
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    },
  );
```

**What's happening:**
1. When browser connects, immediately connect to OpenAI
2. Pass API key in Authorization header (hidden from browser)
3. `OpenAI-Beta` header required for Realtime API access
4. Now we have two WebSocket connections to manage

### 1.5 Session Configuration (Lines 41-64)

```ts
openaiWs.on("open", () => {
  console.log("Connected to OpenAI Realtime API");

  openaiWs.send(
    JSON.stringify({
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        instructions: "You are a helpful voice assistant. Keep responses brief.",
        voice: "alloy",
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        turn_detection: {
          type: "server_vad",
          threshold: 0.6,
          prefix_padding_ms: 300,
          silence_duration_ms: 1000,
        },
      },
    }),
  );
});
```

**Session Configuration Explained:**

| Property | Value | Description |
|----------|-------|-------------|
| `modalities` | `["text", "audio"]` | AI can respond with both text and audio |
| `instructions` | string | System prompt for the AI |
| `voice` | `"alloy"` | Voice style (options: alloy, echo, fable, onyx, nova, shimmer) |
| `input_audio_format` | `"pcm16"` | Audio format we send (16-bit PCM) |
| `output_audio_format` | `"pcm16"` | Audio format AI sends back |
| `turn_detection.type` | `"server_vad"` | Server-side Voice Activity Detection |
| `turn_detection.threshold` | `0.6` | Sensitivity (0.0-1.0, higher = less sensitive) |
| `turn_detection.prefix_padding_ms` | `300` | Audio to keep before speech detected |
| `turn_detection.silence_duration_ms` | `1000` | Wait time after silence before processing |

### 1.6 Message Relay (Lines 70-111)

```ts
// Relay messages: Client → OpenAI
clientWs.on("message", (data) => {
  try {
    const message = JSON.parse(data.toString());
    if (openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.send(JSON.stringify(message));
    }
  } catch (e) {
    console.error("Error parsing client message:", e);
  }
});

// Relay messages: OpenAI → Client
openaiWs.on("message", (data) => {
  const responseString = data.toString();
  if (clientWs.readyState === WebSocket.OPEN) {
    clientWs.send(responseString);
  }
  // ... logging
});
```

**What's happening:**
1. Browser sends audio → Server receives → Server forwards to OpenAI
2. OpenAI sends response → Server receives → Server forwards to Browser
3. Check `readyState === WebSocket.OPEN` before sending (connection might be closed)

### 1.7 Connection Cleanup (Lines 113-135)

```ts
clientWs.on("close", () => {
  console.log("Client disconnected");
  if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
});

openaiWs.on("close", (code, reason) => {
  console.log(`OpenAI connection closed - Code: ${code}, Reason: ${reason}`);
  if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
});
```

**What's happening:**
- If browser disconnects → close OpenAI connection
- If OpenAI disconnects → close browser connection
- Prevents zombie connections

---

## Part 2: Client-Side (page.tsx)

### 2.1 State Management (Lines 6-14)

```tsx
const [isConnected, setIsConnected] = useState(false);
const [isListening, setIsListening] = useState(false);
const [status, setStatus] = useState("Click to start");

const wsRef = useRef<WebSocket | null>(null);
const audioContextRef = useRef<AudioContext | null>(null);
const streamRef = useRef<MediaStream | null>(null);
const processorRef = useRef<ScriptProcessorNode | null>(null);
const audioQueueRef = useRef<AudioBufferSourceNode[]>([]);
```

**Why useRef instead of useState?**
- `useRef` doesn't trigger re-renders
- Audio objects need stable references
- WebSocket connection should persist across renders

| Ref | Purpose |
|-----|---------|
| `wsRef` | WebSocket connection to server |
| `audioContextRef` | Web Audio API context |
| `streamRef` | Microphone MediaStream |
| `processorRef` | Audio processor node |
| `audioQueueRef` | Queue of audio sources for playback |

### 2.2 Starting the Assistant (Lines 17-66)

```tsx
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
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/realtime`);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      setStatus("Connected - Start speaking");
      startAudioCapture(stream, audioContext, ws);
    };
    // ... event handlers
  } catch (error) {
    setStatus("Failed to access microphone");
  }
}, []);
```

**Startup Sequence:**
```
1. Request microphone permission
        ↓
2. Create AudioContext (24kHz sample rate)
        ↓
3. Connect WebSocket to /api/realtime
        ↓
4. On connection open → start audio capture
```

**Audio Settings Explained:**
- `sampleRate: 24000` - OpenAI Realtime requires 24kHz
- `channelCount: 1` - Mono audio (required)
- `echoCancellation: true` - Prevent feedback loops
- `noiseSuppression: true` - Reduce background noise

### 2.3 Audio Format Conversion (Lines 68-88)

```tsx
// Convert Float32 (Web Audio) to Int16 (PCM16)
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

// Convert ArrayBuffer to Base64 string
const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
};
```

**Audio Format Pipeline:**
```
Microphone Output     Conversion           JSON Transport
─────────────────    ───────────────      ──────────────
Float32 (-1 to 1) → Int16 (-32768 to 32767) → Base64 string
```

**Why this conversion?**
1. Web Audio API uses Float32 (-1.0 to 1.0)
2. OpenAI requires PCM16 (-32768 to 32767)
3. WebSocket JSON needs Base64 encoding for binary data

### 2.4 Capturing & Sending Audio (Lines 103-136)

```tsx
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
```

**Audio Processing Chain:**
```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌───────────┐
│ Microphone  │───►│ MediaStream  │───►│ ScriptProc  │───►│ WebSocket │
│             │    │   Source     │    │  (4096 buf) │    │   Send    │
└─────────────┘    └──────────────┘    └─────────────┘    └───────────┘
```

**Buffer Size (4096):**
- Smaller = lower latency, more CPU
- Larger = higher latency, less CPU
- 4096 is a good balance

**Message Format Sent:**
```json
{
  "type": "input_audio_buffer.append",
  "audio": "base64EncodedPCM16Data..."
}
```

### 2.5 Handling Server Messages (Lines 138-188)

```tsx
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
        playAudioChunk(message.delta);
        break;

      case "response.audio.done":
        setStatus("Response complete - Continue speaking");
        break;

      case "input_audio_buffer.speech_started":
        setStatus("Listening...");
        stopAudioPlayback();  // Stop AI audio when user starts speaking
        break;

      case "input_audio_buffer.speech_stopped":
        setStatus("Processing...");
        break;

      case "response.created":
        setStatus("AI is responding...");
        break;

      case "error":
        setStatus(`Error: ${message.error?.message}`);
        break;
    }
  } catch {
    // Binary data - ignore
  }
};
```

**Message Types from OpenAI:**

| Message Type | When Received | Action |
|--------------|---------------|--------|
| `session.created` | After connecting | Log confirmation |
| `session.updated` | After session.update sent | Log confirmation |
| `input_audio_buffer.speech_started` | User starts speaking | Update UI, stop AI audio |
| `input_audio_buffer.speech_stopped` | User stops speaking | Update UI |
| `response.created` | AI starts generating | Update UI |
| `response.audio.delta` | Audio chunk ready | Play audio |
| `response.audio.done` | Response complete | Update UI |
| `error` | Something went wrong | Show error |

### 2.6 Playing Audio Response (Lines 192-241)

```tsx
const nextStartTimeRef = useRef<number>(0);

const playAudioChunk = (base64Audio: string) => {
  if (!audioContextRef.current) return;

  const audioContext = audioContextRef.current;
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }

  try {
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

    // Create buffer
    const buffer = audioContext.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    // Schedule playback
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);

    const currentTime = audioContext.currentTime;
    const startTime = Math.max(currentTime, nextStartTimeRef.current);

    source.start(startTime);
    nextStartTimeRef.current = startTime + buffer.duration;

    audioQueueRef.current.push(source);
  } catch (error) {
    console.error("Error playing audio:", error);
  }
};
```

**Audio Playback Pipeline:**
```
Base64 String → Binary → Int16 Array → Float32 Array → AudioBuffer → Speaker
```

**Scheduling Audio Chunks:**
```
Time ─────────────────────────────────────────────────►

Chunk 1: [████████]
Chunk 2:           [████████]
Chunk 3:                     [████████]
          ↑                   ↑
     startTime          nextStartTime
```

**Why schedule instead of play immediately?**
- Audio chunks arrive faster than they play
- Scheduling ensures gapless playback
- `nextStartTimeRef` tracks when the next chunk should start

---

## Part 3: Data Flow Summary

### Complete Request-Response Cycle

```
1. User speaks into microphone
        ↓
2. Browser captures audio (Float32, 24kHz)
        ↓
3. Convert to PCM16, encode as Base64
        ↓
4. Send WebSocket message: { type: "input_audio_buffer.append", audio: "..." }
        ↓
5. Server relay to OpenAI
        ↓
6. OpenAI VAD detects speech end
        ↓
7. OpenAI processes and generates response
        ↓
8. OpenAI sends audio chunks: { type: "response.audio.delta", delta: "..." }
        ↓
9. Server relay to browser
        ↓
10. Browser decodes Base64 → PCM16 → Float32
        ↓
11. Schedule audio playback through speakers
```

---

## Part 4: Running the Voice Assistant

### Prerequisites

1. Install dependencies:
```bash
npm install ws
npm install -D @types/ws
```

2. Set environment variable:
```env
OPENAI_API_KEY=sk-your-api-key
```

### Start the Server

```bash
# Use the custom WebSocket server (NOT next dev)
npm run dev:ws
```

### Access the Page

Open `http://localhost:3000/voice-assistant`

---

## Part 5: Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| "Failed to access microphone" | Permission denied | Allow microphone in browser |
| "Connection error" | Server not running | Use `npm run dev:ws` not `npm run dev` |
| No audio playback | AudioContext suspended | Click page first (browser policy) |
| Audio choppy | Network latency | Check connection, reduce buffer size |
| Immediate disconnect | API error | Check console for OpenAI error message |
| "server_error" from OpenAI | API issue | May be transient, retry later |

---

## Part 6: Key Takeaways

1. **WebSocket Relay Pattern**: Server acts as secure proxy between browser and API
2. **Audio Format**: PCM16 at 24kHz is required by OpenAI Realtime
3. **Base64 Encoding**: Binary audio data must be encoded for JSON transport
4. **Scheduled Playback**: Audio chunks must be scheduled, not played immediately
5. **VAD (Voice Activity Detection)**: Server detects when user stops speaking
6. **Cleanup**: Always close connections and stop audio when done
