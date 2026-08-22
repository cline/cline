import type { Metadata } from "next";
import Script from "next/script";
import { DesktopErrorTelemetry } from "@/components/desktop-error-telemetry";
import { NativeShell } from "@/components/native-shell";
import { Toaster } from "@/components/ui/toaster";
import { APP_FONT_SIZE_BOOTSTRAP_SCRIPT } from "@/lib/app-font-size";
import { APP_THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
	title: "Cline Bots",
	description: "Build software with Cline Bots.",
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
		<html
			className="dark h-full"
			data-cline-app-theme="dark"
			lang="en"
			suppressHydrationWarning
		>
			<head>
				<Script
					// biome-ignore lint/security/noDangerouslySetInnerHtml: static bootstrap must run before the first paint
					dangerouslySetInnerHTML={{
						__html: APP_FONT_SIZE_BOOTSTRAP_SCRIPT,
					}}
					id="cline-app-font-size-bootstrap"
					strategy="beforeInteractive"
				/>
				<Script
					// biome-ignore lint/security/noDangerouslySetInnerHtml: static bootstrap must run before the first paint
					dangerouslySetInnerHTML={{ __html: APP_THEME_BOOTSTRAP_SCRIPT }}
					id="cline-app-theme-bootstrap"
					strategy="beforeInteractive"
				/>
			</head>
			<body className="h-full min-h-screen font-sans antialiased">
				<DesktopErrorTelemetry />
				<NativeShell />
				{children}
				<Toaster />
			</body>
		</html>
	);
}
