import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import type { RunArtifactCodeResult } from "./ArtifactKernelService"

export interface CellProvenanceRecord {
	artifactId: string
	cellId: string
	codeHash: string
	pythonExecutable: string
	pythonVersion: string
	cwd: string
	profileId: string
	startedAt: string
	durationMs: number
	status: string
}

function runsDir(workspaceFolder: string): string {
	return path.join(workspaceFolder, ".aihydro", "runs")
}

export function hashCode(code: string): string {
	return `sha256:${createHash("sha256").update(code, "utf8").digest("hex")}`
}

export async function writeCellProvenance(
	workspaceFolder: string | null,
	record: CellProvenanceRecord,
): Promise<string | undefined> {
	if (!workspaceFolder) {
		return undefined
	}
	const dir = runsDir(workspaceFolder)
	await fs.promises.mkdir(dir, { recursive: true })
	const id = `${record.artifactId}_${record.cellId}_${Date.now()}`
	const filePath = path.join(dir, `${id}.json`)
	await fs.promises.writeFile(filePath, JSON.stringify(record, null, 2), "utf8")
	return id
}

export function mapResultStatus(result: RunArtifactCodeResult): string {
	if (result.status === "ok") {
		return "success"
	}
	return result.status
}
