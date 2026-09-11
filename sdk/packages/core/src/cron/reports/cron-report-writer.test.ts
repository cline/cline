import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CronRunRecord, CronSpecRecord } from "../store/sqlite-cron-store";
import { writeCronRunReport } from "./cron-report-writer";

const cleanupPaths: string[] = [];

function createReport(
	data: Parameters<typeof writeCronRunReport>[0]["data"],
	specOverrides: Partial<CronSpecRecord> = {},
): string {
	const directory = mkdtempSync(join(tmpdir(), "cline-cron-report-"));
	cleanupPaths.push(directory);
	const timestamp = "2026-07-29T12:00:00.000Z";
	const run: CronRunRecord = {
		runId: "run-1",
		specId: "spec-1",
		specRevision: 1,
		triggerKind: "schedule",
		status: data.error ? "failed" : "done",
		attemptCount: 1,
		startedAt: timestamp,
		completedAt: timestamp,
		createdAt: timestamp,
		updatedAt: timestamp,
	};
	const spec: CronSpecRecord = {
		specId: "spec-1",
		externalId: "schedule-1",
		sourcePath: "schedule.cron.md",
		triggerKind: "schedule",
		parseStatus: "valid",
		enabled: true,
		removed: false,
		title: "Test schedule",
		scheduleExpr: "0 * * * *",
		revision: 1,
		createdAt: timestamp,
		updatedAt: timestamp,
		...specOverrides,
	};

	const reportPath = writeCronRunReport({
		specs: { cronSpecsDir: directory },
		workspaceRoot: directory,
		run,
		spec,
		data,
	});
	return readFileSync(reportPath, "utf8");
}

afterEach(() => {
	for (const path of cleanupPaths.splice(0)) {
		rmSync(path, { recursive: true, force: true });
	}
});

describe("writeCronRunReport", () => {
	it("keeps Hub-managed schedule titles inside the heading and bold narrative", () => {
		const report = createReport(
			{},
			{
				source: "hub-schedule",
				title: "Hub report\n# injected **heading**",
			},
		);

		expect(report).toContain(
			"# Hub report \\# injected \\*\\*heading\\*\\* — completed",
		);
		expect(report).toContain(
			"Run of schedule **Hub report \\# injected \\*\\*heading\\*\\*** (triggered by its schedule)",
		);
		expect(report).not.toContain("\n# injected");
	});

	it("keeps file-based schedule titles inside the heading and bold narrative", () => {
		const report = createReport(
			{},
			{ title: "File **breakout**\n## forged section" },
		);

		expect(report).toContain(
			"# File \\*\\*breakout\\*\\* \\#\\# forged section — completed",
		);
		expect(report).toContain(
			"Run of schedule **File \\*\\*breakout\\*\\* \\#\\# forged section** (triggered by its schedule)",
		);
		expect(report).not.toContain("\n## forged section");
	});

	it("uses fences longer than backtick runs in prompts and errors", () => {
		const prompt =
			"Inspect this:\n```ts\nconst value = 1;\n```\nThen continue.";
		const error = "Command failed:\n````text\nunexpected output\n````";
		const report = createReport({ error }, { prompt });

		expect(report).toContain(`### Prompt\n\n\`\`\`\`\n${prompt}\n\`\`\`\``);
		expect(report).toContain(
			`## Error\n\nThe run failed with the following error:\n\n\`\`\`\`\`\n${error}\n\`\`\`\`\``,
		);
	});

	it("normalizes rounded duration seconds into minutes", () => {
		const report = createReport({
			durationMs: 119_500,
			usage: {},
			toolCalls: [{ name: "execute_command", durationMs: 119_500 }],
		});

		expect(report.match(/2m 0s/g)).toHaveLength(3);
		expect(report).not.toContain("1m 60s");
	});
});
