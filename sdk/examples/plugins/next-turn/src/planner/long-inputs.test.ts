import { describe, expect, test } from "bun:test";
import { EMPTY_BACKLOG } from "./backlog";
import { NextSession } from "./session/session";
import { defaultSettings } from "../settings/settings";
import { message, runResult } from "../test-support/agent-runs";

describe("a turn whose task, status and checks are long", () => {
	test("orders the rows status, tasks, connector and keeps every row", async () => {
		const session = new NextSession({
			sessionId: "sess_1",
			settings: defaultSettings,
			env: () => ({ client: "cline-cli", tools: [] }),
			sources: () => [
				{ id: "turn", tier: "T0", probe: () => "present" },
				{ id: "status", tier: "T2", probe: () => "present" },
				{ id: "tasks", tier: "T2", probe: () => "present" },
				{
					id: "github",
					tier: "T3",
					probe: () => "present",
					capabilities: () => ["github", "remote:github"],
				},
			],
			backlog: async () => ({
				...EMPTY_BACKLOG,
				statusRows: [
					{
						subject: "migration/auth",
						state: "blocked",
						headline: "a".repeat(110),
					},
				],
				tasks: [
					{
						taskId: "t1",
						title: "b".repeat(200),
						status: "approved",
						priority: 2,
						updatedAt: 1,
					},
				],
			}),
			github: () => ({
				failingChecks: Array.from(
					{ length: 6 },
					(_, index) => `build (ubuntu-latest, node ${20 + index})`,
				),
			}),
		});
		const set = await session.afterRun(runResult([message("user", "Go")]));
		expect(set?.candidates.map((row) => row.source)).toEqual([
			"status",
			"tasks",
			"connector",
		]);
	});
});
