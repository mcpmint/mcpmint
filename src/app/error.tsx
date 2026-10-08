"use client";
import Link from "next/link";
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto max-w-xl px-6 py-24" role="alert">
      <h1 className="text-3xl font-semibold">Something went wrong</h1>
      <p className="mt-4 text-muted-foreground">
        Try this page again, or open your saved projects to recover your work.
      </p>
      <div className="mt-8 flex gap-6">
        <button onClick={reset} className="text-primary underline">
          Try again
        </button>
        <Link href="/import" className="underline">
          Open projects
        </Link>
        <Link href="/" className="underline">
          Home
        </Link>
      </div>
    </main>
  );
}
