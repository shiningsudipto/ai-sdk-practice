"use client";

import { useCompletion } from "@ai-sdk/react";
import { useState, useRef, useEffect } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export default function StreamPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    input,
    completion,
    handleSubmit,
    isLoading,
    error,
    handleInputChange,
    stop,
    setInput,
  } = useCompletion({
    api: "/api/text-generate/stream",
    onFinish: (_prompt, completion) => {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: completion },
      ]);
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, completion]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    setMessages((prev) => [...prev, { role: "user", content: input.trim() }]);
    handleSubmit(e);
  };

  return (
    <div className="min-h-screen p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Text Generate (Stream)</h1>
      <div className="flex flex-col h-[85vh]">
        <div className="flex-1 overflow-y-auto space-y-4 mb-4">
          {messages.map((message, index) => (
            <div
              key={index}
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
                {message.content}
              </div>
            </div>
          ))}
          {isLoading && completion && (
            <div className="flex justify-start">
              <div className="max-w-[80%] p-3 rounded-lg whitespace-pre-wrap bg-gray-100 text-gray-900">
                {completion}
              </div>
            </div>
          )}
          {isLoading && !completion && (
            <div className="flex justify-start">
              <div className="bg-gray-100 text-gray-500 p-3 rounded-lg">
                Generating...
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

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(e);
            setInput("");
          }}
          className="space-y-4"
        >
          <textarea
            value={input}
            onChange={handleInputChange}
            placeholder="Enter your prompt..."
            className="w-full p-3 border rounded-lg min-h-[100px] resize-y"
            disabled={isLoading}
          />
          <div className="flex justify-end gap-2">
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
              disabled={isLoading || !input.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50"
            >
              {isLoading ? "Generating..." : "Generate"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
