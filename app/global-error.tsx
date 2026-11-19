"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="id">
      <body style={{ fontFamily: "Arial, sans-serif", textAlign: "center", padding: 80 }}>
        <h1>Aplikasi mengalami gangguan</h1>
        <p>Silakan muat ulang halaman.</p>
        <button type="button" onClick={reset}>Muat ulang</button>
      </body>
    </html>
  );
}
