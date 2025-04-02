import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"

import { ThemeProvider, ReactQueryProvider } from "@/components/providers"
import { Toaster } from "@/components/ui"
import { Header } from "@/components/layout/header"

import "./globals.css"

const fontSans = Geist({ variable: "--font-sans", subsets: ["latin"] })
const fontMono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] })

export const metadata: Metadata = {
	title: "Roo Code Benchmarks",
}

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode
}>) {
	return (
		<html lang="en">
			<body className={`${fontSans.variable} ${fontMono.variable} font-sans antialiased pb-12`}>
				<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
					<ReactQueryProvider>
						<Header />
						{children}
					</ReactQueryProvider>
				</ThemeProvider>
				<Toaster />
			</body>
		</html>
	)
}
