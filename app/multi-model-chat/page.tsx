"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import Image from "next/image";
import { useRef, useEffect, useState } from "react";

export default function MultiModelChatPage() {
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<FileList | undefined>(undefined);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { messages, status, error, stop, sendMessage } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/multi-model-chat",
    }),
  });

  const isLoading = status === "submitted" || status === "streaming";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (selectedFiles && selectedFiles.length > 0) {
      setFiles(selectedFiles);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(selectedFiles[0]);
    }
  };

  const removeImage = () => {
    setFiles(undefined);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() && !files) return;

    sendMessage({
      text: input,
      files,
    });

    setInput("");
    removeImage();
  };

  return (
    <div className="min-h-screen p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Multi-Model Chat</h1>
      <div className="flex flex-col h-[85vh]">
        <div className="flex-1 overflow-y-auto space-y-4 mb-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${
                message.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[80%] p-3 rounded-lg whitespace-pre-wrap ${
                  message.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-900"
                }`}
              >
                {message.parts.map((part, index) => {
                  switch (part.type) {
                    case "text":
                      return <span key={index}>{part.text}</span>;
                    case "file":
                      if (part.mediaType?.startsWith("image/")) {
                        return (
                          <Image
                            key={index}
                            src={part.url}
                            alt="Uploaded"
                            height={500}
                            width={500}
                            className="max-w-full rounded-lg mt-2"
                          />
                        );
                      }
                      return null;
                    default:
                      return null;
                  }
                })}
              </div>
            </div>
          ))}
          {status === "submitted" && (
            <div className="flex justify-start">
              <div className="bg-gray-100 text-gray-500 p-3 rounded-lg">
                Thinking...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-100 text-red-700 rounded-lg">
            {error.message}
          </div>
        )}

        {imagePreview && (
          <div className="mb-2 relative inline-block">
            <Image
              src={imagePreview}
              alt="Preview"
              className="max-h-32 rounded-lg"
              height={500}
              width={500}
            />
            <button
              type="button"
              onClick={removeImage}
              className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm"
            >
              ×
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            className="w-full p-3 border rounded-lg min-h-[100px] resize-y"
            disabled={isLoading}
          />
          <div className="flex justify-between items-center">
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="hidden"
                id="image-upload"
              />
              <label
                htmlFor="image-upload"
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg cursor-pointer hover:bg-gray-300"
              >
                Upload Image
              </label>
            </div>
            <div className="flex gap-2">
              {isLoading && (
                <button
                  type="button"
                  onClick={stop}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg"
                >
                  Stop
                </button>
              )}
              <button
                type="submit"
                disabled={isLoading || (!input.trim() && !files)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50"
              >
                {isLoading ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
