import { describe, expect, it, vi } from "vitest";
import type { SessionRecord } from "../types/sessions";
import { hydrateSessionHistory } from "./history";

function createRow(
	overrides: Partial<SessionRecord> & Pick<SessionRecord, "sessionId">,
): SessionRecord {
	return {
		source: "cli",
		pid: 1,
		startedAt: "2026-04-21T02:17:46.169Z",
		status: "completed",
		interactive: false,
		provider: "",
		model: "",
		cwd: "/tmp/workspace",
		workspaceRoot: "/tmp/workspace",
		enableTools: true,
		enableSpawn: false,
		enableTeams: false,
		isSubagent: false,
		updatedAt: "2026-04-21T02:17:46.169Z",
		...overrides,
	};
}

describe("hydrateSessionHistory", () => {
	it("preserves rows that already have history display metadata", async () => {
		const readMessages = vi.fn();
		const rows = await hydrateSessionHistory({ readMessages }, [
			createRow({
				sessionId: "sess_1",
				provider: "cline",
				model: "anthropic/claude-sonnet-4.6",
				prompt: "hello",
				metadata: {
					title: "hello",
					totalCost: 0.02,
				},
			}),
		]);

		expect(rows).toEqual([
			expect.objectContaining({
				sessionId: "sess_1",
				provider: "cline",
				model: "anthropic/claude-sonnet-4.6",
				metadata: expect.objectContaining({
					title: "hello",
					totalCost: 0.02,
				}),
			}),
		]);
		expect(readMessages).not.toHaveBeenCalled();
	});

	it("hydrates missing provider, model, and cost from stored messages", async () => {
		const readMessages = vi.fn().mockResolvedValue([
			{
				role: "user",
				content: [{ type: "text", text: "hello" }],
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "hi" }],
				modelInfo: {
					provider: "cline",
					id: "anthropic/claude-sonnet-4.6",
				},
				metrics: {
					cost: 0.02,
				},
			},
		]);

		const [row] = await hydrateSessionHistory({ readMessages }, [
			createRow({
				sessionId: "sess_2",
				prompt: "hello",
				metadata: {},
			}),
		]);

		expect(readMessages).toHaveBeenCalledWith("sess_2");
		expect(row).toMatchObject({
			sessionId: "sess_2",
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
			metadata: {
				title: "hello",
				totalCost: 0.02,
			},
		});
	});

	it("falls back to nested metadata provider/model ids before reading messages", async () => {
		const readMessages = vi.fn().mockResolvedValue([]);

		const [row] = await hydrateSessionHistory({ readMessages }, [
			createRow({
				sessionId: "sess_3",
				metadata: {
					title: "hello",
					provider: { id: "cline" },
					model: { id: "anthropic/claude-haiku-4.5" },
				},
			}),
		]);

		expect(row.provider).toBe("cline");
		expect(row.model).toBe("anthropic/claude-haiku-4.5");
		expect(readMessages).toHaveBeenCalledWith("sess_3");
	});
});
