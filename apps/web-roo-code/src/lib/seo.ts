const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://roocode.com"

export const SEO = {
	url: SITE_URL,
	name: "Roo Code",
	title: "Roo Code – Your AI-Powered Dev Team in VS Code",
	description:
		"Roo Code puts an entire AI dev team right in your editor, outpacing closed tools with deep project-wide context, multi-step agentic coding, and unmatched developer-centric flexibility.",
	locale: "en_US",
	ogImage: {
		url: "/android-chrome-512x512.png",
		width: 512,
		height: 512,
		alt: "Roo Code Logo",
	},
	keywords: [
		"Roo Code",
		"AI coding agent",
		"VS Code extension",
		"AI pair programmer",
		"software development",
		"agentic coding",
		"code refactoring",
		"debugging",
	],
	category: "technology",
	twitterCard: "summary_large_image" as const,
} as const

export type SeoConfig = typeof SEO
