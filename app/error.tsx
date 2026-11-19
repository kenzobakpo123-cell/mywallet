"use client";

export default function ErrorBoundary({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="loading-screen">
      <div className="brand-mark">!</div>
      <h1>Something went wrong</h1>
      <p>Data gagal dimuat. Coba muat ulang bagian ini.</p>
      <button className="primary-button" type="button" onClick={reset}>Coba lagi</button>
    </main>
  );
}
