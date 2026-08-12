import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TrackWise — your job search, organized",
  description:
    "An applicant tracking system built for the job seeker. Track applications, schedule interviews, manage contacts, and never lose a follow-up.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
