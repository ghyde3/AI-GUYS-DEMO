import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Messy Data Summarizer",
  description: "Messy input in, structured summary out, delivered anywhere.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
