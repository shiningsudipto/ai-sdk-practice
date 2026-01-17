import Link from "next/link";

const page = () => {
  return (
    <div className="flex flex-col justify-center items-center min-h-screen text-lg font-semibold space-y-5">
      <Link href={"text-generate"}>Generate text</Link>
      <Link href={"text-generate/stream"}>Stream: Generate text</Link>
      <Link href={"chat"}>Chat</Link>
    </div>
  );
};

export default page;
