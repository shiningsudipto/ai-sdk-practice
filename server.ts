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
    console.log("Client connected to realtime");

    // Connect to OpenAI Realtime API
    const openaiWs = new WebSocket(
      "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview",
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "OpenAI-Beta": "realtime=v1",
        },
      },
    );

    openaiWs.on("open", () => {
      console.log("Connected to OpenAI Realtime API");

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
              threshold: 0.6,
              prefix_padding_ms: 300,
              silence_duration_ms: 1000,
            },
          },
        }),
      );
    });

    openaiWs.on("error", (error) => {
      console.error("OpenAI WebSocket error:", error);
    });

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

      // Log message types for debugging
      try {
        const msg = JSON.parse(responseString);
        console.log("OpenAI message:", msg.type);

        if (msg.type === "response.done") {
          console.log(
            "Response Done details:",
            JSON.stringify(msg.response, null, 2),
          );
        }

        if (msg.type === "error") {
          console.error(
            "OpenAI API Error:",
            JSON.stringify(msg.error, null, 2),
          );
        }
      } catch {
        // Binary data
      }
    });

    // Cleanup on close
    clientWs.on("close", () => {
      console.log("Client disconnected");
      if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
    });

    openaiWs.on("close", (code, reason) => {
      console.log(
        `OpenAI connection closed - Code: ${code}, Reason: ${reason.toString()}`,
      );
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
    });

    // ... unexpected-response handler (keep existing)
    openaiWs.on("unexpected-response", (_req, res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        console.error(`OpenAI unexpected response (${res.statusCode}):`, data);
      });
    });
  }

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`> Ready on http://localhost:${PORT}`);
  });
});
