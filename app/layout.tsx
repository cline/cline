import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cline Gateway",
  description: "Connect directly and securely to your Cline Gateway.",
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
