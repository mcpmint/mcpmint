"use client";
import Link from "next/link";
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{ fontFamily: "system-ui", margin: "3rem", lineHeight: 1.6 }}
      >
        <main role="alert">
          <h1>mcpmint could not load this page</h1>
          <p>
            Try again or return to your saved projects. Browser storage is
            preserved.
          </p>
          <button onClick={reset}>Try again</button>
          <p>
            <Link href="/import">Open projects</Link> ·{" "}
            <Link href="/">Back to home</Link>
          </p>
        </main>
      </body>
    </html>
  );
}
