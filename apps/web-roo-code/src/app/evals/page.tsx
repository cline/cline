import type { Metadata } from "next"

import { getEvalRuns } from "@/actions/evals"
import { SEO } from "@/lib/seo"

import { Evals } from "./evals"

export const revalidate = 300
export const dynamic = "force-dynamic"

const TITLE = "Evals"
const DESCRIPTION = "Explore quantitative evals of LLM coding skills across tasks and providers."
const PATH = "/evals"
const IMAGE = {
	url: "https://i.imgur.com/ijP7aZm.png",
	width: 1954,
	height: 1088,
	alt: "Roo Code Evals – LLM coding benchmarks",
}

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
		images: [IMAGE],
		locale: SEO.locale,
		type: "website",
	},
	twitter: {
		card: SEO.twitterCard,
		title: TITLE,
		description: DESCRIPTION,
		images: [IMAGE.url],
	},
	keywords: [...SEO.keywords, "benchmarks", "LLM evals", "coding evaluations", "model comparison"],
}

export default async function Page() {
	const runs = await getEvalRuns()

	return <Evals runs={runs} />
}
