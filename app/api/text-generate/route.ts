import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();
    const { text } = await generateText({
      model: openai("gpt-4.1-nano"),
      prompt: prompt,
    });
    return Response.json({ text });
  } catch (error) {
    console.log("Error generating text:", error);
    return Response.json({
      error: "Failed to generate text",
      status: 500,
    });
  }
}
