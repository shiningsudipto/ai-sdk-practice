import { openai } from "@ai-sdk/openai";
import { convertToModelMessages, streamText, UIMessage } from "ai";

export async function POST(req: Request) {
  try {
    const { messages }: { messages: UIMessage[] } = await req.json();
    const convertedModelMessages = await convertToModelMessages(messages);
    const result = streamText({
      model: openai("gpt-4.1-nano"),
      messages: convertedModelMessages,
    });
    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error(error);
    return new Response("Failed to stream chat completion", { status: 500 });
  }
}
