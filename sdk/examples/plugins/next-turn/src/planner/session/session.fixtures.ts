import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ContextSource, SourceEnv } from "../../context/source";
import { defaultSettings, type Settings } from "../../settings/settings";
import { type Backlog, EMPTY_BACKLOG } from "../backlog";
import { LabelLog } from "../labels/labels";
import { PlannerLedger, readLedgerTail } from "../model/allowance";
import type { Complete } from "../model/model";
import type { OfferedSet } from "../tray/tray";
import { type NextOptions, NextSession } from "./session";

export const sources: ContextSource[] = [
	{ id: "turn", tier: "T0", probe: () => "present" },
	{ id: "git", tier: "T1", probe: () => "present" },
	{ id: "tasks", tier: "T2", probe: () => "present" },
	{ id: "status", tier: "T2", probe: () => "absent" },
	{
		id: "repo",
		tier: "T1",
		probe: () => "present",
		facts: () => ({
			heading: "This repository's commands",
			lines: ["bun run check"],
		}),
	},
];

export const env: SourceEnv = {
	client: "cline-cli",
	workspaceRoot: "/w",
	git: { branch: "main", remotes: [] },
	tools: [],
};

export const MODEL_ANSWER =
	'{"suggestions":[{"kind":"verify","source":"turn","prompt":"Run bun test src/client.test.ts.","why":"client.ts changed"},{"kind":"wrap_up","source":"turn","prompt":"Summarize the retry change.","why":"done"}]}';

export function sessionHarness(tempDir: (label?: string) => string) {
	return function harness(
		overrides: Partial<NextOptions> = {},
		settings: Settings = defaultSettings(),
	) {
		const dir = tempDir();
		const labelsPath = join(dir, "labels.jsonl");
		const calls: string[] = [];
		const complete: Complete = async (input, _signal, _settings, meter) => {
			calls.push(input.user);
			meter.note({
				type: "usage",
				inputTokens: 0,
				outputTokens: 0,
				totalCost: 0.001,
				id: "r",
			});
			return { text: MODEL_ANSWER };
		};
		const sets: (OfferedSet | undefined)[] = [];
		const backlog: Backlog = {
			...EMPTY_BACKLOG,
			tasks: [
				{
					taskId: "t1",
					title: "Ship the tray",
					status: "approved",
					priority: 2,
					updatedAt: 1,
				},
			],
		};
		const ledgerPath = join(dir, "planner.jsonl");
		const session = new NextSession({
			sessionId: "sess_1",
			settings: () => settings,
			env: () => env,
			sources: () => sources,
			backlog: async () => backlog,
			dirtyFiles: async () => 2,
			complete,
			ledger: new PlannerLedger(ledgerPath),
			labels: new LabelLog(labelsPath),
			...overrides,
		});
		session.onSet((set) => sets.push(set));
		const labels = () =>
			readFileSync(labelsPath, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as Record<string, unknown>);
		const ledgerCalls = () => readLedgerTail(ledgerPath);
		return { session, sets, calls, labels, ledgerCalls };
	};
}
