import Link from "next/link";

const page = () => {
  return (
    <div className="flex flex-col justify-center items-center min-h-screen text-lg font-semibold">
      <Link href={"text-generate"}>Generate text</Link>
    </div>
  );
};

export default page;
