import { openai } from "@ai-sdk/openai";
import { generateImage } from "ai";

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();

    const { image } = await generateImage({
      model: openai.imageModel("dall-e-3"),
      prompt,
      size: "1024x1024",
      providerOptions: {
        openai: {
          style: "vivid",
          quality: "hd",
        },
      },
    });
    return Response.json(image.base64);
  } catch (error) {
    console.log("Error failed to generate image:", error);
    return new Response("Error failed to generate image", { status: 500 });
  }
}
