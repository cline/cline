"use server"

import { client, getProductionClient, copyRun } from "@roo-code/evals"

export async function copyRunToProduction(runId: number) {
	try {
		await copyRun({ sourceDb: client, targetDb: getProductionClient(), runId })

		return {
			success: true,
			message: `Run ${runId} successfully copied to production.`,
		}
	} catch (error) {
		return {
			success: false,
			error: `Failed to copy run ${runId} to production: ${error instanceof Error ? error.message : "Unknown error"}.`,
		}
	}
}
