import { openai } from "@ai-sdk/openai";
import { experimental_transcribe as transcribe } from "ai";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get("audio") as File;

    if (!audioFile) {
      return new Response("No audio file provided", {
        status: 500,
      });
    }

    const arrayBuffer = await audioFile.arrayBuffer();
    const unit8Array = new Uint8Array(arrayBuffer);

    const transcript = await transcribe({
      model: openai.transcription("whisper-1"),
      audio: unit8Array,
    });

    return Response.json(transcript);
  } catch (error) {
    console.error("Failed to transcribe: ", error);
    return new Response("Failed to transcribe", { status: 500 });
  }
}
