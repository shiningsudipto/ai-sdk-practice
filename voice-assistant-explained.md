# Voice Assistant - Complete Implementation Guide

This guide explains the StrategyByte voice assistant implementation, covering the WebSocket relay server, client-side audio handling, and tool integration.

---

## Architecture Overview

```
┌──────────────────────┐      ┌────────────────────┐      ┌─────────────────────┐
│      Browser         │      │   Custom Server    │      │  OpenAI Realtime    │
│  (voice-assistant)   │      │   (server.ts)      │      │       API           │
│                      │      │                    │      │                     │
│  ┌────────────────┐  │      │  ┌──────────────┐  │      │                     │
│  │ Microphone     │──┼──────┼─►│    Relay     │──┼──────┼──►                  │
│  │ (PCM16 Audio)  │  │  WS  │  │              │  │  WS  │                     │
│  └────────────────┘  │      │  │  ┌────────┐  │  │      │                     │
│                      │      │  │  │ Tools  │  │  │      │                     │
│  ┌────────────────┐  │      │  │  └────────┘  │  │      │                     │
│  │ Speaker        │◄─┼──────┼─◄│              │◄─┼──────┼──◄                  │
│  │ (Audio Output) │  │      │  └──────────────┘  │      │                     │
│  └────────────────┘  │      │         │          │      │                     │
└──────────────────────┘      │    ┌────▼────┐     │      └─────────────────────┘
                              │    │ MongoDB │     │
                              │    └─────────┘     │
                              └────────────────────┘
```

**Why a relay server?**
- OpenAI Realtime API requires an API key in headers
- Browser WebSocket cannot set custom headers
- Server acts as a secure proxy, hiding the API key
- Server can execute tools (database operations, file reads)

---

## Part 1: Server-Side (server.ts)

### 1.1 Imports and Setup

```ts
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import { readFileSync } from "fs";
import { join } from "path";
import { MongoClient } from "mongodb";
```

**Dependencies:**
- `http` - Create HTTP server
- `url` - Parse request URLs
- `next` - Next.js framework
- `ws` - WebSocket library
- `fs` - Read JSON files
- `mongodb` - Database for bookings

### 1.2 Database Connection

```ts
let mongoClient: MongoClient | null = null;

async function getMongoDb() {
  if (!mongoClient) {
    mongoClient = new MongoClient(process.env.DATABASE_URL!);
    await mongoClient.connect();
  }
  return mongoClient.db();
}
```

**What's happening:**
- Lazy connection - only connects when needed
- Connection caching - reuses existing connection
- Uses `DATABASE_URL` from environment variables

### 1.3 Loading Static Data

```ts
const employees = JSON.parse(
  readFileSync(join(process.cwd(), "public", "employee.json"), "utf-8")
);
const aboutData = JSON.parse(
  readFileSync(join(process.cwd(), "public", "about.json"), "utf-8")
);
const faqData = JSON.parse(
  readFileSync(join(process.cwd(), "public", "faq.json"), "utf-8")
);
```

**What's happening:**
- Reads JSON files at server startup
- Data is kept in memory for fast tool execution
- Files are in `public/` directory

### 1.4 Tool Definitions

OpenAI Realtime API uses JSON Schema format for tools:

```ts
const tools = [
  {
    type: "function",
    name: "getEmployeeByName",
    description: "Search for an employee by name...",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The name or partial name of the employee",
        },
      },
      required: ["name"],
    },
  },
  // ... more tools
];
```

**Available Tools:**

| Tool | Description | Parameters |
|------|-------------|------------|
| `getEmployeeByName` | Search employee by name | `name: string` |
| `getEmployeeByDesignation` | Filter by job role | `designation: string` |
| `getAllEmployees` | List all employees | none |
| `getCompanyInfo` | Company description & mission | none |
| `getServices` | List/filter services | `serviceName?: string` |
| `searchFAQ` | Search FAQs by keyword | `query: string` |
| `getFAQsByCategory` | Get FAQs by category | `category: string` |
| `createBooking` | Create appointment | `name, email, phone` |

### 1.5 Tool Execution Handler

```ts
async function executeTool(name: string, args: Record<string, string>) {
  switch (name) {
    case "getEmployeeByName": {
      const searchTerm = args.name.toLowerCase();
      const found = employees.filter((emp) =>
        emp.name.toLowerCase().includes(searchTerm)
      );
      if (found.length === 0) {
        return { success: false, message: `No employee found...` };
      }
      return { success: true, employees: found };
    }

    case "createBooking": {
      const { name, email, phone } = args;
      const db = await getMongoDb();
      const collection = db.collection("bookings");

      const booking = { name, email, phone, createdAt: new Date() };
      const result = await collection.insertOne(booking);

      return {
        success: true,
        message: `Booking created successfully for ${name}...`,
        bookingId: result.insertedId.toString(),
      };
    }
    // ... other cases
  }
}
```

**Key Points:**
- `async` function - supports database operations
- Returns structured JSON response
- Each tool has success/failure handling

### 1.6 WebSocket Server Setup

```ts
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
```

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

### 1.7 OpenAI Connection & Session Config

```ts
function handleRealtimeConnection(clientWs: WebSocket) {
  const openaiWs = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview",
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    }
  );

  openaiWs.on("open", () => {
    openaiWs.send(JSON.stringify({
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        instructions: `You are Sukuna, the voice assistant for StrategyByte...`,
        voice: "alloy",
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        turn_detection: {
          type: "server_vad",
          threshold: 0.6,
          prefix_padding_ms: 300,
          silence_duration_ms: 1000,
        },
        tools: tools,
      },
    }));
  });
}
```

**Session Configuration:**

| Property | Value | Description |
|----------|-------|-------------|
| `modalities` | `["text", "audio"]` | AI can respond with both |
| `instructions` | string | System prompt for the AI |
| `voice` | `"alloy"` | Voice style |
| `input_audio_format` | `"pcm16"` | 16-bit PCM audio input |
| `output_audio_format` | `"pcm16"` | 16-bit PCM audio output |
| `turn_detection.type` | `"server_vad"` | Server-side Voice Activity Detection |
| `turn_detection.threshold` | `0.6` | Sensitivity (0-1) |
| `turn_detection.silence_duration_ms` | `1000` | Wait time after silence |
| `tools` | array | Available function tools |

### 1.8 Message Relay & Tool Call Handling

```ts
// Relay: Client → OpenAI
clientWs.on("message", (data) => {
  const message = JSON.parse(data.toString());
  if (openaiWs.readyState === WebSocket.OPEN) {
    openaiWs.send(JSON.stringify(message));
  }
});

// Relay: OpenAI → Client (with tool handling)
openaiWs.on("message", (data) => {
  const responseString = data.toString();

  // Always relay to client
  if (clientWs.readyState === WebSocket.OPEN) {
    clientWs.send(responseString);
  }

  const msg = JSON.parse(responseString);

  // Handle tool calls
  if (msg.type === "response.function_call_arguments.done") {
    const { call_id, name, arguments: argsString } = msg;

    (async () => {
      const args = JSON.parse(argsString);
      const result = await executeTool(name, args);

      // Send tool result back to OpenAI
      openaiWs.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: call_id,
          output: JSON.stringify(result),
        },
      }));

      // Continue the conversation
      openaiWs.send(JSON.stringify({
        type: "response.create",
      }));
    })();
  }
});
```

**Tool Call Flow:**
```
1. User asks: "Who is the CTO?"
        ↓
2. OpenAI decides to call tool: getEmployeeByDesignation
        ↓
3. Server receives: response.function_call_arguments.done
        ↓
4. Server executes: executeTool("getEmployeeByDesignation", {designation: "CTO"})
        ↓
5. Server sends result: conversation.item.create (function_call_output)
        ↓
6. Server requests continuation: response.create
        ↓
7. OpenAI generates voice response with the data
```

---

## Part 2: Client-Side (voice-assistant/page.tsx)

### 2.1 State Management

```tsx
const [isConnected, setIsConnected] = useState(false);
const [isListening, setIsListening] = useState(false);
const [status, setStatus] = useState("Click to start");

const wsRef = useRef<WebSocket | null>(null);
const audioContextRef = useRef<AudioContext | null>(null);
const streamRef = useRef<MediaStream | null>(null);
const processorRef = useRef<ScriptProcessorNode | null>(null);
const audioQueueRef = useRef<AudioBufferSourceNode[]>([]);
const nextStartTimeRef = useRef<number>(0);
```

**Why useRef?**
- Audio objects need stable references across renders
- WebSocket connection should persist
- No re-renders needed for these values

### 2.2 Starting the Assistant

```tsx
const startAssistant = useCallback(async () => {
  // 1. Get microphone access
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      sampleRate: 24000,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });

  // 2. Setup audio context
  const audioContext = new AudioContext({ sampleRate: 24000 });

  // 3. Connect to WebSocket
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${window.location.host}/api/realtime`);

  ws.onopen = () => {
    setIsConnected(true);
    startAudioCapture(stream, audioContext, ws);
  };

  ws.onmessage = (event) => {
    handleServerMessage(event.data);
  };
}, []);
```

**Startup Sequence:**
```
1. Request microphone permission
        ↓
2. Create AudioContext (24kHz)
        ↓
3. Connect WebSocket to /api/realtime
        ↓
4. On connection → start audio capture
```

### 2.3 Audio Format Conversion

```tsx
// Web Audio (Float32) → OpenAI (PCM16)
const floatTo16BitPCM = (float32Array: Float32Array) => {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
};

// Binary → Base64 for JSON transport
const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
};
```

**Conversion Pipeline:**
```
Microphone      Conversion           JSON Transport
─────────────  ───────────────      ──────────────
Float32 (-1,1) → Int16 (-32768,32767) → Base64 string
```

### 2.4 Audio Capture & Sending

```tsx
const startAudioCapture = async (stream, audioContext, ws) => {
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);

  source.connect(processor);
  processor.connect(audioContext.destination);

  processor.onaudioprocess = (e) => {
    if (ws.readyState !== WebSocket.OPEN) return;

    const inputData = e.inputBuffer.getChannelData(0);
    const pcm16Buffer = floatTo16BitPCM(inputData);
    const base64Audio = arrayBufferToBase64(pcm16Buffer);

    ws.send(JSON.stringify({
      type: "input_audio_buffer.append",
      audio: base64Audio,
    }));
  };
};
```

**Audio Processing Chain:**
```
Microphone → MediaStreamSource → ScriptProcessor → WebSocket
                                  (4096 samples)
```

### 2.5 Handling Server Messages

```tsx
const handleServerMessage = (data: string) => {
  const message = JSON.parse(data);

  switch (message.type) {
    case "session.created":
    case "session.updated":
      console.log(message.type);
      break;

    case "response.audio.delta":
      playAudioChunk(message.delta);
      break;

    case "input_audio_buffer.speech_started":
      setStatus("Listening...");
      stopAudioPlayback(); // Interrupt AI when user speaks
      break;

    case "input_audio_buffer.speech_stopped":
      setStatus("Processing...");
      break;

    case "response.created":
      setStatus("AI is responding...");
      break;

    case "response.audio.done":
      setStatus("Response complete - Continue speaking");
      break;

    case "error":
      setStatus(`Error: ${message.error?.message}`);
      break;
  }
};
```

**Message Types:**

| Type | When | Action |
|------|------|--------|
| `session.created` | After connecting | Log |
| `session.updated` | After config sent | Log |
| `input_audio_buffer.speech_started` | User starts speaking | Stop AI audio |
| `input_audio_buffer.speech_stopped` | User stops speaking | Show "Processing" |
| `response.created` | AI starts responding | Show "Responding" |
| `response.audio.delta` | Audio chunk ready | Play audio |
| `response.audio.done` | Response complete | Update status |
| `error` | Something wrong | Show error |

### 2.6 Playing Audio Response

```tsx
const playAudioChunk = (base64Audio: string) => {
  const audioContext = audioContextRef.current;

  // Decode base64 → PCM16 → Float32
  const binaryString = atob(base64Audio);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const pcm16 = new Int16Array(bytes.buffer);

  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    float32[i] = pcm16[i] / 0x7fff;
  }

  // Create and schedule audio buffer
  const buffer = audioContext.createBuffer(1, float32.length, 24000);
  buffer.getChannelData(0).set(float32);

  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);

  // Schedule for gapless playback
  const startTime = Math.max(audioContext.currentTime, nextStartTimeRef.current);
  source.start(startTime);
  nextStartTimeRef.current = startTime + buffer.duration;

  audioQueueRef.current.push(source);
};
```

**Scheduled Playback:**
```
Time ────────────────────────────────────────────►
Chunk 1: [████████]
Chunk 2:           [████████]
Chunk 3:                     [████████]
```

---

## Part 3: Text Chat Alternative (sb-assistant/page.tsx)

For users who prefer text chat, there's also a text-based interface:

```tsx
"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

export default function SBAssistant() {
  const [input, setInput] = useState("");

  const { messages, status, sendMessage } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/sb-info-bank",
    }),
  });

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      sendMessage({ text: input });
      setInput("");
    }}>
      {/* Chat UI */}
    </form>
  );
}
```

**Key Differences from Voice:**
- Uses AI SDK's `useChat` hook
- Text-based input/output
- Same tools available via `/api/sb-info-bank`

---

## Part 4: Running the Application

### Prerequisites

```bash
# Install dependencies
npm install ws mongodb
npm install -D @types/ws
```

### Environment Variables

```env
OPENAI_API_KEY=sk-your-api-key
DATABASE_URL=mongodb+srv://user:pass@cluster.mongodb.net/dbname
```

### Start the Server

```bash
# Use custom WebSocket server (NOT next dev)
npm run dev:ws
```

### Access Pages

- Voice Assistant: `http://localhost:3000/voice-assistant`
- Text Chat: `http://localhost:3000/sb-assistant`
- View Bookings: `http://localhost:3000/booking`

---

## Part 5: Complete Data Flow

### Voice Conversation with Tool Call

```
1. User speaks: "I want to book a consultation"
        ↓
2. Browser captures audio (Float32, 24kHz)
        ↓
3. Convert to PCM16, encode as Base64
        ↓
4. WebSocket send: { type: "input_audio_buffer.append", audio: "..." }
        ↓
5. Server relays to OpenAI
        ↓
6. OpenAI VAD detects speech end
        ↓
7. OpenAI processes and decides to call createBooking tool
        ↓
8. Server receives: response.function_call_arguments.done
        ↓
9. But wait - AI needs user info first, so it asks for name/email/phone
        ↓
10. User provides info through voice
        ↓
11. AI calls createBooking with { name, email, phone }
        ↓
12. Server executes tool → MongoDB insert
        ↓
13. Server sends result back to OpenAI
        ↓
14. OpenAI generates confirmation response
        ↓
15. Audio chunks sent to browser
        ↓
16. Browser plays: "Booking confirmed for John..."
```

---

## Part 6: Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| "Failed to access microphone" | Permission denied | Allow mic in browser |
| "Connection error" | Wrong server | Use `npm run dev:ws` |
| No audio playback | AudioContext suspended | Click page first |
| Tool not executing | Check server logs | Look for "Tool call:" logs |
| Booking not saving | MongoDB connection | Check DATABASE_URL |
| "server_error" from OpenAI | API issue | Retry or check status |

---

## Part 7: Key Takeaways

1. **WebSocket Relay**: Server proxies between browser and OpenAI, hiding API key
2. **Audio Format**: PCM16 at 24kHz is required by OpenAI Realtime
3. **Base64 Encoding**: Binary audio must be encoded for JSON transport
4. **Tool Integration**: Server executes tools and returns results to OpenAI
5. **Async Tools**: Database operations work with async/await in tool handlers
6. **Scheduled Playback**: Audio chunks must be scheduled for gapless playback
7. **VAD**: Server-side Voice Activity Detection handles turn-taking
