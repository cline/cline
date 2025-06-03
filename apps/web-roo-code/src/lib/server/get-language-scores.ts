"use server"

import { sql } from "drizzle-orm"
import { db, tasks } from "@/db"

export type Language = "go" | "java" | "javascript" | "python" | "rust"

export const getLanguageScores = async () => {
	const records = await db
		.select({
			runId: tasks.runId,
			language: sql<Language>`language`,
			score: sql<number>`cast(sum(case when ${tasks.passed} = 1 then 1 else 0 end) as float) / count(*)`,
		})
		.from(tasks)
		.groupBy(tasks.runId, tasks.language)

	const results: Record<number, Record<Language, number>> = {}

	for (const { runId, language, score } of records) {
		if (!results[runId]) {
			results[runId] = { go: 0, java: 0, javascript: 0, python: 0, rust: 0 }
		}

		results[runId][language] = score
	}

	return results
}
