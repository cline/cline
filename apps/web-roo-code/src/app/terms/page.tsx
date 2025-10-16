import type { Metadata } from "next"
import { SEO } from "@/lib/seo"
import fs from "fs"
import path from "path"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeRaw from "rehype-raw"

const TITLE = "Terms of Service"
const DESCRIPTION =
	"Terms of Service for Roo Code Cloud. Learn about our service terms, commercial conditions, and legal framework."
const PATH = "/terms"
const OG_IMAGE = SEO.ogImage

export const metadata: Metadata = {
	title: TITLE,
	description: DESCRIPTION,
	alternates: {
		canonical: `${SEO.url}${PATH}`,
	},
	openGraph: {
		title: TITLE,
		description: DESCRIPTION,
		url: `${SEO.url}${PATH}`,
		siteName: SEO.name,
		images: [
			{
				url: OG_IMAGE.url,
				width: OG_IMAGE.width,
				height: OG_IMAGE.height,
				alt: OG_IMAGE.alt,
			},
		],
		locale: SEO.locale,
		type: "article",
	},
	twitter: {
		card: SEO.twitterCard,
		title: TITLE,
		description: DESCRIPTION,
		images: [OG_IMAGE.url],
	},
	keywords: [...SEO.keywords, "terms of service", "legal", "agreement", "subscription"],
}

function getTermsContent() {
	const filePath = path.join(process.cwd(), "src/app/terms/terms.md")
	return fs.readFileSync(filePath, "utf8")
}

export default function Terms() {
	const content = getTermsContent()

	return (
		<div className="container mx-auto px-4 py-12 sm:px-6 lg:px-8">
			<div className="prose prose-lg mx-auto max-w-4xl dark:prose-invert">
				<ReactMarkdown
					remarkPlugins={[remarkGfm]}
					rehypePlugins={[rehypeRaw]}
					components={{
						h1: ({ ...props }) => (
							<h1 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl" {...props} />
						),
						h2: ({ ...props }) => <h2 className="mt-12 text-2xl font-bold" {...props} />,
						a: ({ ...props }) => (
							<a
								className="text-primary hover:underline"
								target="_blank"
								rel="noopener noreferrer"
								{...props}
							/>
						),
						table: ({ ...props }) => (
							<div className="overflow-x-auto">
								<table className="min-w-full border-collapse border border-border" {...props} />
							</div>
						),
						th: ({ ...props }) => (
							<th
								className="border border-border px-4 py-2 text-left font-bold bg-muted-foreground/5"
								{...props}
							/>
						),
						td: ({ node: _node, ...props }) => {
							// Check if this is the first column (Term column)
							const isTermColumn = _node?.position?.start.column === 1
							if (isTermColumn) {
								return <td className="border border-border px-4 py-2 font-medium" {...props} />
							}
							return <td className="border border-border px-4 py-2" {...props} />
						},
					}}>
					{content}
				</ReactMarkdown>
			</div>
		</div>
	)
}
