import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DockCampus",
  description: "Container management for students and professors",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
