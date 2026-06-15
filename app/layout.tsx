import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "podsynth — the whole show, your length",
  description: "Synthesize an entire podcast into a read of the length you choose.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
