import Link from "next/link";
export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-6 py-24">
      <p className="text-primary">404</p>
      <h1 className="mt-4 text-3xl font-semibold">Page not found</h1>
      <p className="mt-4 text-muted-foreground">
        This address does not exist. Your saved projects remain in this browser.
      </p>
      <nav className="mt-8 flex gap-6">
        <Link href="/" className="text-primary underline">
          Back to home
        </Link>
        <Link href="/import" className="underline">
          Open your projects
        </Link>
      </nav>
    </main>
  );
}
