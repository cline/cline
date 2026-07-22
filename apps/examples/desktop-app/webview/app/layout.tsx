import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { Toaster } from "@/components/ui/toaster";
import "./globals.css";

export const metadata: Metadata = {
	title: "Cline",
	description: "Build software with Cline.",
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
				<Toaster />
				<Analytics />
			</body>
		</html>
	);
}
