import { connectToDatabase } from "@/lib/db";

// POST: Create a new booking
export async function POST(req: Request) {
  try {
    const { email, phone, name } = await req.json();

    // Validate required fields
    if (!email || !phone || !name) {
      return Response.json(
        { error: "Missing required fields: email, phone, name" },
        { status: 400 }
      );
    }

    const { db } = await connectToDatabase();
    const collection = db.collection("bookings");

    const booking = {
      email,
      phone,
      name,
      createdAt: new Date(),
    };

    const result = await collection.insertOne(booking);

    return Response.json(
      {
        success: true,
        message: "Booking created successfully",
        bookingId: result.insertedId,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating booking:", error);
    return Response.json(
      { error: "Failed to create booking" },
      { status: 500 }
    );
  }
}

// GET: Get all bookings (newest first)
export async function GET() {
  try {
    const { db } = await connectToDatabase();
    const collection = db.collection("bookings");

    const bookings = await collection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    return Response.json({
      success: true,
      count: bookings.length,
      bookings,
    });
  } catch (error) {
    console.error("Error fetching bookings:", error);
    return Response.json(
      { error: "Failed to fetch bookings" },
      { status: 500 }
    );
  }
}
