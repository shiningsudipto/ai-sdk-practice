"use client";

import { useEffect, useState } from "react";

type Booking = {
  _id: string;
  name: string;
  email: string;
  phone: string;
  createdAt: string;
};

export default function BookingPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBookings = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/bookings");
      const data = await response.json();

      if (data.success) {
        setBookings(data.bookings);
      } else {
        setError(data.error || "Failed to fetch bookings");
      }
    } catch {
      setError("Failed to fetch bookings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBookings();
  }, []);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  };

  return (
    <div className="min-h-screen p-8 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Bookings</h1>
        <button
          onClick={fetchBookings}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Refresh
        </button>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-100 text-red-700 rounded-lg mb-4">
          {error}
        </div>
      )}

      {!loading && !error && bookings.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          No bookings yet. Use the voice assistant to create one!
        </div>
      )}

      {!loading && bookings.length > 0 && (
        <div className="space-y-4">
          {bookings.map((booking) => (
            <div
              key={booking._id}
              className="p-4 border rounded-lg bg-white shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-lg">{booking.name}</h3>
                  <p className="text-gray-600">{booking.email}</p>
                  <p className="text-gray-600">{booking.phone}</p>
                </div>
                <span className="text-sm text-gray-400">
                  {formatDate(booking.createdAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 p-4 bg-gray-100 rounded-lg text-sm text-gray-600">
        <p className="font-semibold mb-2">How to create a booking:</p>
        <p>
          Go to the{" "}
          <a href="/voice-assistant" className="text-blue-600 underline">
            Voice Assistant
          </a>{" "}
          and say something like:
        </p>
        <ul className="list-disc list-inside mt-2 space-y-1">
          <li>&quot;I want to book a consultation&quot;</li>
          <li>&quot;Schedule a meeting for John Doe, email john@example.com, phone 0123456789&quot;</li>
          <li>&quot;Create a booking for me&quot;</li>
        </ul>
      </div>
    </div>
  );
}
