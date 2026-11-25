import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";

export const metadata: Metadata = {
	title: {
		default: "21 Agent — cloud AI coding",
		template: "%s · 21 Agent",
	},
	description:
		"21 Agent is a premium cloud AI coding platform. Describe a task and a real agent plans, edits files, runs commands and tests inside an isolated Daytona sandbox.",
	applicationName: "21 Agent",
	authors: [{ name: "21 Agent" }],
	keywords: ["AI coding agent", "cloud IDE", "Daytona", "OpenRouter", "Cline"],
	openGraph: {
		title: "21 Agent — cloud AI coding",
		description: "Real agents. Real sandboxes. Real diffs.",
		type: "website",
	},
	robots: { index: true, follow: true },
};

export const viewport: Viewport = {
	themeColor: "#050609",
	width: "device-width",
	initialScale: 1,
	colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body className="min-h-dvh antialiased">{children}</body>
		</html>
	);
}
