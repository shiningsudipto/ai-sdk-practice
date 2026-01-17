import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import { readFileSync } from "fs";
import { join } from "path";

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

// Load data from JSON files
const employees = JSON.parse(
  readFileSync(join(process.cwd(), "public", "employee.json"), "utf-8")
);
const aboutData = JSON.parse(
  readFileSync(join(process.cwd(), "public", "about.json"), "utf-8")
);
const faqData = JSON.parse(
  readFileSync(join(process.cwd(), "public", "faq.json"), "utf-8")
);

// Define tools for OpenAI Realtime API
const tools = [
  {
    type: "function",
    name: "getEmployeeByName",
    description:
      "Search for an employee by name. Returns employee details if found.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The name or partial name of the employee to search for",
        },
      },
      required: ["name"],
    },
  },
  {
    type: "function",
    name: "getEmployeeByDesignation",
    description: "Get all employees with a specific designation/role",
    parameters: {
      type: "object",
      properties: {
        designation: {
          type: "string",
          description:
            "The job designation to filter by (e.g., 'Full-Stack Engineer', 'CTO')",
        },
      },
      required: ["designation"],
    },
  },
  {
    type: "function",
    name: "getAllEmployees",
    description: "Get a list of all employees at StrategyByte",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    type: "function",
    name: "getCompanyInfo",
    description:
      "Get information about StrategyByte company including description and mission",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    type: "function",
    name: "getServices",
    description: "Get list of services offered by StrategyByte",
    parameters: {
      type: "object",
      properties: {
        serviceName: {
          type: "string",
          description:
            "Optional service name to filter (e.g., 'Website', 'SEO', 'Brand')",
        },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "searchFAQ",
    description:
      "Search FAQs by keyword. Use when user asks about services, pricing, or processes.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search term to find relevant FAQs (e.g., 'cost', 'SEO', 'brand')",
        },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "getFAQsByCategory",
    description:
      "Get all FAQs for a specific category (Marketing, Content, Website, Brand)",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description:
            "Category: 'Marketing Agency', 'Content Marketing', 'Website Development', or 'Brand Management'",
        },
      },
      required: ["category"],
    },
  },
];

// Tool execution handlers
function executeTool(name: string, args: Record<string, string>) {
  switch (name) {
    case "getEmployeeByName": {
      const searchTerm = args.name.toLowerCase();
      const found = employees.filter((emp: { name: string }) =>
        emp.name.toLowerCase().includes(searchTerm)
      );
      if (found.length === 0) {
        return { success: false, message: `No employee found matching "${args.name}"` };
      }
      return { success: true, employees: found };
    }

    case "getEmployeeByDesignation": {
      const searchTerm = args.designation.toLowerCase();
      const found = employees.filter((emp: { designation: string }) =>
        emp.designation.toLowerCase().includes(searchTerm)
      );
      if (found.length === 0) {
        return { success: false, message: `No employees found with designation "${args.designation}"` };
      }
      return { success: true, count: found.length, employees: found };
    }

    case "getAllEmployees": {
      const summary = employees.map((emp: { name: string; designation: string; email: string }) => ({
        name: emp.name,
        designation: emp.designation,
        email: emp.email,
      }));
      return { success: true, count: employees.length, employees: summary };
    }

    case "getCompanyInfo": {
      return {
        success: true,
        company: aboutData.company_name,
        description: aboutData.description,
        closingStatement: aboutData.closing_statement,
      };
    }

    case "getServices": {
      if (args.serviceName) {
        const searchTerm = args.serviceName.toLowerCase();
        const found = aboutData.services.filter(
          (service: { title: string; description: string }) =>
            service.title.toLowerCase().includes(searchTerm) ||
            service.description.toLowerCase().includes(searchTerm)
        );
        if (found.length === 0) {
          return { success: false, message: `No service found matching "${args.serviceName}"` };
        }
        return { success: true, services: found };
      }
      return {
        success: true,
        intro: aboutData.services_intro,
        services: aboutData.services,
      };
    }

    case "searchFAQ": {
      const searchTerm = args.query.toLowerCase();
      const results: { category: string; question: string; answer: string }[] = [];
      faqData.forEach((category: { title_highlight: string; faqs: { question: string; answer: string }[] }) => {
        category.faqs.forEach((faq) => {
          if (
            faq.question.toLowerCase().includes(searchTerm) ||
            faq.answer.toLowerCase().includes(searchTerm)
          ) {
            results.push({
              category: category.title_highlight,
              question: faq.question,
              answer: faq.answer,
            });
          }
        });
      });
      if (results.length === 0) {
        return { success: false, message: `No FAQs found matching "${args.query}"` };
      }
      return { success: true, count: results.length, faqs: results };
    }

    case "getFAQsByCategory": {
      const searchTerm = args.category.toLowerCase();
      const found = faqData.find((cat: { title_highlight: string }) =>
        cat.title_highlight.toLowerCase().includes(searchTerm)
      );
      if (!found) {
        const categories = faqData.map((cat: { title_highlight: string }) => cat.title_highlight);
        return {
          success: false,
          message: `Category not found. Available: ${categories.join(", ")}`,
        };
      }
      return {
        success: true,
        category: found.title_highlight,
        count: found.faqs.length,
        faqs: found.faqs,
      };
    }

    default:
      return { success: false, message: `Unknown tool: ${name}` };
  }
}

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

      // Configure session with tools
      openaiWs.send(
        JSON.stringify({
          type: "session.update",
          session: {
            modalities: ["text", "audio"],
            instructions: `You are Sukuna, the voice assistant for StrategyByte (SB), a digital agency.
You have access to tools for employee information, company info, services, and FAQs.
Use the appropriate tool to answer questions about StrategyByte.
Keep responses brief and conversational for voice.
Introduce yourself as Sukuna when greeted.`,
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

      // Log message types and handle tool calls
      try {
        const msg = JSON.parse(responseString);
        console.log("OpenAI message:", msg.type);

        // Handle function calls from the AI
        if (msg.type === "response.function_call_arguments.done") {
          const { call_id, name, arguments: argsString } = msg;
          console.log(`Tool call: ${name}`, argsString);

          try {
            const args = JSON.parse(argsString);
            const result = executeTool(name, args);
            console.log(`Tool result:`, result);

            // Send the tool result back to OpenAI
            openaiWs.send(
              JSON.stringify({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: call_id,
                  output: JSON.stringify(result),
                },
              })
            );

            // Request the AI to continue responding
            openaiWs.send(
              JSON.stringify({
                type: "response.create",
              })
            );
          } catch (e) {
            console.error("Error executing tool:", e);
          }
        }

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
