import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
	title: "Gateway Desktop",
	description: "Phase 3 validation client for the Cline Gateway.",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html
			className="dark h-full"
			data-cline-hub-theme="dark"
			lang="en"
			suppressHydrationWarning
		>
			<body className="h-full min-h-screen font-sans antialiased">
				{children}
			</body>
		</html>
	);
}
