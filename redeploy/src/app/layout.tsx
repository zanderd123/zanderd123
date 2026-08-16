import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Redeploy — keep travelers on assignment",
  description:
    "A retention console for healthcare staffing agencies: see which travelers are about to walk, and what it costs.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
