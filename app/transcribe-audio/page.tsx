"use client";

import { useState, useRef } from "react";
import axios from "axios";

interface TranscriptResult {
  text: string;
  segments?: Array<{ start: number; end: number; text: string }>;
  language?: string;
  durationInSeconds: number;
}

export default function TranscribeAudioPage() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<TranscriptResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setResult(null);
      setError("");
    }
  };

  const removeFile = () => {
    setFile(null);
    setResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("audio", file);

      const { data } = await axios.post("/api/transcribe-audio", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setResult(data);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data || err.message);
      } else {
        setError("An unexpected error occurred");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Transcribe Audio</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            onChange={handleFileChange}
            className="hidden"
            id="audio-upload"
          />

          {!file ? (
            <label
              htmlFor="audio-upload"
              className="flex flex-col items-center cursor-pointer"
            >
              <div className="text-4xl mb-2">🎵</div>
              <span className="text-gray-600">Click to select an audio file</span>
              <span className="text-gray-400 text-sm mt-1">
                Supports MP3, WAV, M4A, etc.
              </span>
            </label>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🎵</span>
                <div>
                  <p className="font-medium">{file.name}</p>
                  <p className="text-sm text-gray-500">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={removeFile}
                className="text-red-600 hover:text-red-800"
              >
                Remove
              </button>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={loading || !file}
          className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg disabled:opacity-50"
        >
          {loading ? "Transcribing..." : "Transcribe"}
        </button>
      </form>

      {loading && (
        <div className="mt-6 p-4 bg-gray-100 rounded-lg animate-pulse">
          <div className="h-4 bg-gray-300 rounded w-3/4 mb-2"></div>
          <div className="h-4 bg-gray-300 rounded w-1/2"></div>
        </div>
      )}

      {error && (
        <div className="mt-6 p-4 bg-red-100 text-red-700 rounded-lg">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-6 space-y-4">
          <div className="p-4 bg-gray-100 rounded-lg">
            <h2 className="font-semibold mb-2">Transcript</h2>
            <p className="whitespace-pre-wrap">{result.text}</p>
          </div>

          <div className="flex gap-4 text-sm text-gray-600">
            {result.language && <span>Language: {result.language}</span>}
            {result.durationInSeconds && (
              <span>Duration: {result.durationInSeconds.toFixed(1)}s</span>
            )}
          </div>

          {result.segments && result.segments.length > 0 && (
            <div className="p-4 bg-gray-50 rounded-lg">
              <h2 className="font-semibold mb-2">Segments</h2>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {result.segments.map((segment, index) => (
                  <div key={index} className="text-sm">
                    <span className="text-gray-500">
                      [{segment.start.toFixed(1)}s - {segment.end.toFixed(1)}s]
                    </span>{" "}
                    {segment.text}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
