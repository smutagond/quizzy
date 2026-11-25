import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quizz — Good questions. Great moments.",
  description: "Host real-time quizzes for classrooms, teams, and live events—no downloads or sign-ups for players.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
