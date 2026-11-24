import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  applicationName: "Finwise",
  title: "Finwise — Buku Kas Harian",
  description: "Catat pemasukan, pengeluaran, dan anggaran bulanan di satu tempat.",
  openGraph: {
    title: "Finwise — Buku Kas Harian",
    description: "Catat pemasukan, pengeluaran, dan anggaran bulanan di satu tempat.",
    type: "website",
  },
};

export const viewport = { width: "device-width", initialScale: 1, themeColor: "#f7f5ef" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
