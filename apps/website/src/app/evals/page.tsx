import type { Metadata } from "next"

import { rooCodeSettingsSchema, getModelId } from "@roo-code/types"

import { getRuns } from "@/db"
import { getLanguageScores } from "@/lib/server"
import { formatScore } from "@/lib"

import { Evals } from "./evals"

export const revalidate = 300

export const metadata: Metadata = {
	title: "Roo Code Evals",
	openGraph: {
		title: "Roo Code Evals",
		description: "Quantitative evals of LLM coding skills.",
		url: "https://roocode.com/evals",
		siteName: "Roo Code",
		images: {
			url: "https://i.imgur.com/ijP7aZm.png",
			width: 1954,
			height: 1088,
		},
	},
}

export default async function Page() {
	const languageScores = await getLanguageScores()

	const runs = (await getRuns())
		.filter((run) => !!run.taskMetrics)
		.filter(({ settings }) => rooCodeSettingsSchema.safeParse(settings).success)
		.sort((a, b) => b.passed - a.passed)
		.map((run) => {
			const settings = rooCodeSettingsSchema.parse(run.settings)

			return {
				...run,
				label: run.description || run.model,
				score: formatScore(run.passed / (run.passed + run.failed)),
				languageScores: languageScores[run.id],
				taskMetrics: run.taskMetrics!,
				modelId: getModelId(settings),
			}
		})

	return <Evals runs={runs} />
}
