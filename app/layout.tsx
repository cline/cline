import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cline Gateway",
  description: "Connect directly and securely to your Cline Gateway.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
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
