import { describe, expect, it } from "bun:test"
import { importSummaryBelongsToWorkspace } from "../../../../sdk/packages/core/src/services/session-import/service"
import type { ImportableSessionSummary } from "../../../../sdk/packages/core/src/services/session-import/types"

function filterImportablesForWorkspaceRoots(summaries: ImportableSessionSummary[], roots: string[]): ImportableSessionSummary[] {
	return summaries.filter((summary) => roots.some((root) => importSummaryBelongsToWorkspace(summary, root)))
}

describe("Cursor History import workspace filtering", () => {
	it("keeps importable rows that match any open workspace root", () => {
		const summaries: ImportableSessionSummary[] = [
			{
				tool: "cursor",
				sourceId: "Users-ue-projects-hermes-cloud/agent-transcripts/a/a",
				sourcePath: "/tmp/hermes.jsonl",
				title: "Hermes chat",
				cwd: "",
				startedAtMs: 1,
				updatedAtMs: 2,
				messageCount: 1,
			},
			{
				tool: "cursor",
				sourceId: "Users-ue-projects-cline/agent-transcripts/b/b",
				sourcePath: "/tmp/cline.jsonl",
				title: "Cline chat",
				cwd: "",
				startedAtMs: 3,
				updatedAtMs: 4,
				messageCount: 1,
			},
		]

		const filtered = filterImportablesForWorkspaceRoots(summaries, [
			"/Users/ue/projects/hermes-cloud",
			"/Users/ue/projects/cline",
		])

		expect(filtered.map((summary) => summary.title)).toEqual(["Hermes chat", "Cline chat"])
	})

	it("excludes Cursor rows from other workspace folders when Workspace Only is on", () => {
		const summaries: ImportableSessionSummary[] = [
			{
				tool: "cursor",
				sourceId: "Users-ue-projects-hermes-cloud/agent-transcripts/a/a",
				sourcePath: "/tmp/hermes.jsonl",
				title: "Hermes chat",
				cwd: "",
				startedAtMs: 1,
				updatedAtMs: 2,
				messageCount: 1,
			},
			{
				tool: "cursor",
				sourceId: "Users-ue-projects-cline/agent-transcripts/b/b",
				sourcePath: "/tmp/cline.jsonl",
				title: "Cline chat",
				cwd: "",
				startedAtMs: 3,
				updatedAtMs: 4,
				messageCount: 1,
			},
		]

		const filtered = filterImportablesForWorkspaceRoots(summaries, ["/Users/ue/projects/hermes-cloud"])

		expect(filtered.map((summary) => summary.title)).toEqual(["Hermes chat"])
	})
})
