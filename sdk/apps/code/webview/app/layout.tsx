import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
	title: "Agent Desktop",
	description: "AI coding agent interface",
	generator: "v0.app",
	icons: {
		icon: [
			{
				url: "/32x32.png",
				media: "(prefers-color-scheme: light)",
			},
			{
				url: "/32x32.png",
				media: "(prefers-color-scheme: dark)",
			},
			{
				url: "/icon.svg",
				type: "image/svg+xml",
			},
		],
		apple: "/icon.png",
	},
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html className="h-full" lang="en">
			<body className="h-full min-h-screen font-sans antialiased">
				{children}
				<Analytics />
			</body>
		</html>
	);
}
