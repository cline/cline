import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
	type ResolveCronSpecsDirOptions,
	resolveCronReportsDir,
	resolveCronSpecsDir,
} from "@cline/shared/storage";
import type {
	CronEventLogRecord,
	CronRunRecord,
	CronSpecRecord,
} from "../store/sqlite-cron-store";

/**
 * Writes a markdown report for a completed or failed cron run.
 * Reports live under `<cron-specs-dir>/reports/<run-id>.md`.
 * By default that is `~/.cline/cron/reports/<run-id>.md`.
 * and are derived artifacts — the database is still the operational source
 * of truth.
 */

export interface CronRunReportData {
	finalText?: string;
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
		totalCost?: number;
	};
	toolCalls?: Array<{ name: string; error?: string; durationMs?: number }>;
	durationMs?: number;
	error?: string;
	/** Optional context for where in the run lifecycle the error occurred. */
	errorContext?: string;
	triggerEvent?: CronEventLogRecord;
}

export interface WriteReportOptions {
	/**
	 * Cron spec source/report location. Defaults to global `~/.cline/cron`.
	 * Pass `{ scope: "workspace", workspaceRoot }` to write reports beside a
	 * future workspace-scoped cron specs directory.
	 */
	specs?: ResolveCronSpecsDirOptions;
	workspaceRoot: string;
	run: CronRunRecord;
	spec: CronSpecRecord;
	data: CronRunReportData;
}

function escapeYamlString(value: string): string {
	// Minimal escaping: wrap in quotes only when needed.
	if (/[:#\n]/.test(value) || value.includes('"')) {
		return JSON.stringify(value);
	}
	return value;
}

function yamlEntry(key: string, value: string | undefined): string | undefined {
	if (value === undefined || value === null) return undefined;
	return `${key}: ${escapeYamlString(value)}`;
}

function fencedCodeBlock(content: string): string {
	let longestBacktickRun = 0;
	for (const match of content.matchAll(/`+/g)) {
		longestBacktickRun = Math.max(longestBacktickRun, match[0].length);
	}
	const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
	return `${fence}\n${content}\n${fence}`;
}

/**
 * Keep user-controlled text inside a single Markdown inline context. Schedule
 * titles are rendered both in a heading and inside bold text, so line breaks
 * and Markdown punctuation must not be allowed to alter the report structure.
 */
function escapeMarkdownInline(value: string): string {
	return value
		.replace(/[\r\n\u2028\u2029]+/g, " ")
		.replace(/[\\`*_[\]{}()#+\-.!<>|]/g, "\\$&");
}

/**
 * Hub-managed schedules use a virtual sourcePath (`hub/schedules/<id>.cron.md`)
 * that never exists on disk — the definition lives in cron.db. File-based specs
 * store a path relative to the cron specs directory; resolve it so the report
 * points at a real file.
 */
function describeDefinitionSource(
	spec: CronSpecRecord,
	specsOptions: ResolveCronSpecsDirOptions | undefined,
): { kind: "database" | "file"; path?: string; label: string } {
	if (spec.source === "hub-schedule") {
		return {
			kind: "database",
			label: `managed schedule \`${spec.externalId}\` stored in cron.db (edit via the schedule tools/UI, not a file)`,
		};
	}
	const path = isAbsolute(spec.sourcePath)
		? spec.sourcePath
		: join(resolveCronSpecsDir(specsOptions), spec.sourcePath);
	return { kind: "file", path, label: path };
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const roundedSeconds = Math.round(seconds);
	const minutes = Math.floor(roundedSeconds / 60);
	const rest = roundedSeconds % 60;
	return `${minutes}m ${rest}s`;
}

function formatSchedule(spec: CronSpecRecord): string | undefined {
	if (spec.triggerKind === "one_off") return "one-time run";
	if (spec.scheduleExpr) {
		return spec.timezone
			? `\`${spec.scheduleExpr}\` (${spec.timezone})`
			: `\`${spec.scheduleExpr}\``;
	}
	if (spec.eventType) return `on event \`${spec.eventType}\``;
	return undefined;
}

function buildFrontmatter(
	run: CronRunRecord,
	spec: CronSpecRecord,
	definition: ReturnType<typeof describeDefinitionSource>,
	triggerEvent?: CronEventLogRecord,
): string {
	const entries: string[] = [
		`runId: ${escapeYamlString(run.runId)}`,
		`specId: ${escapeYamlString(spec.specId)}`,
		`scheduleId: ${escapeYamlString(spec.externalId)}`,
		`title: ${escapeYamlString(spec.title)}`,
		`triggerKind: ${escapeYamlString(run.triggerKind)}`,
		`status: ${escapeYamlString(run.status)}`,
		`definitionSource: ${escapeYamlString(definition.kind)}`,
	];
	const optional = [
		yamlEntry("sourcePath", definition.path),
		yamlEntry("workspaceRoot", spec.workspaceRoot),
		yamlEntry("schedule", spec.scheduleExpr),
		yamlEntry("timezone", spec.timezone),
		yamlEntry(
			"model",
			spec.providerId || spec.modelId
				? [spec.providerId, spec.modelId].filter(Boolean).join("/")
				: undefined,
		),
		yamlEntry("sessionId", run.sessionId),
		yamlEntry("startedAt", run.startedAt),
		yamlEntry("completedAt", run.completedAt),
		yamlEntry("triggerEventId", run.triggerEventId),
		yamlEntry("triggerEventType", triggerEvent?.eventType),
		yamlEntry("triggerEventSource", triggerEvent?.source),
		yamlEntry("triggerEventSubject", triggerEvent?.subject),
	];
	for (const entry of optional) if (entry) entries.push(entry);
	return `---\n${entries.join("\n")}\n---\n`;
}

function buildHeader(
	run: CronRunRecord,
	spec: CronSpecRecord,
	definition: ReturnType<typeof describeDefinitionSource>,
	data: CronRunReportData,
): string {
	const title = escapeMarkdownInline(spec.title);
	const statusWord =
		run.status === "done"
			? "completed"
			: run.status === "failed"
				? "FAILED"
				: run.status;
	const trigger =
		run.triggerKind === "manual"
			? "triggered manually"
			: run.triggerKind === "event"
				? "triggered by an event"
				: run.triggerKind === "one_off"
					? "one-time run"
					: "triggered by its schedule";
	const when = run.startedAt ? ` at ${run.startedAt}` : "";
	const duration =
		data.durationMs !== undefined
			? ` in ${formatDuration(data.durationMs)}`
			: "";
	const lines = [
		`# ${title} — ${statusWord}`,
		"",
		`Run of schedule **${title}** (${trigger})${when}, ${statusWord}${duration}.`,
		"",
		"## Job",
		"",
	];
	const facts = [
		`- **Definition**: ${definition.label}`,
		spec.workspaceRoot ? `- **Workspace**: ${spec.workspaceRoot}` : "",
		formatSchedule(spec) ? `- **Schedule**: ${formatSchedule(spec)}` : "",
		spec.providerId || spec.modelId
			? `- **Model**: ${[spec.providerId, spec.modelId].filter(Boolean).join("/")}`
			: "",
		run.sessionId ? `- **Session**: ${run.sessionId}` : "",
	].filter((line) => line.length > 0);
	lines.push(...facts, "");
	const prompt = spec.prompt?.trim();
	if (prompt) {
		lines.push("### Prompt", "", fencedCodeBlock(prompt), "");
	}
	return lines.join("\n");
}

function buildBody(data: CronRunReportData): string {
	const sections: string[] = [];
	if (data.triggerEvent) {
		const event = data.triggerEvent;
		const lines = [
			`- eventId: ${event.eventId}`,
			`- eventType: ${event.eventType}`,
			`- source: ${event.source}`,
			event.subject ? `- subject: ${event.subject}` : "",
			`- occurredAt: ${event.occurredAt}`,
			event.dedupeKey ? `- dedupeKey: ${event.dedupeKey}` : "",
			event.attributes
				? `- attributes: ${JSON.stringify(event.attributes)}`
				: "",
		].filter((line) => line.length > 0);
		sections.push(`## Trigger Event\n\n${lines.join("\n")}\n`);
	}
	if (data.error) {
		const context = data.errorContext
			? `${data.errorContext}\n\n`
			: "The run failed with the following error:\n\n";
		sections.push(`## Error\n\n${context}${fencedCodeBlock(data.error)}\n`);
	}
	if (data.finalText && data.finalText.trim().length > 0) {
		sections.push(`## Summary\n\n${data.finalText.trim()}\n`);
	}
	if (data.usage) {
		const u = data.usage;
		const lines = [
			u.inputTokens !== undefined ? `- Input tokens: ${u.inputTokens}` : "",
			u.outputTokens !== undefined ? `- Output tokens: ${u.outputTokens}` : "",
			u.cacheReadTokens !== undefined
				? `- Cache read tokens: ${u.cacheReadTokens}`
				: "",
			u.cacheWriteTokens !== undefined
				? `- Cache write tokens: ${u.cacheWriteTokens}`
				: "",
			u.totalCost !== undefined
				? `- Total cost: $${u.totalCost.toFixed(2)}`
				: "",
			data.durationMs !== undefined
				? `- Duration: ${formatDuration(data.durationMs)}`
				: "",
		].filter((line) => line.length > 0);
		if (lines.length > 0) {
			sections.push(`## Usage\n\n${lines.join("\n")}\n`);
		}
	}
	if (data.toolCalls && data.toolCalls.length > 0) {
		const bullets = data.toolCalls.map((call) => {
			const parts = [`- ${call.name}`];
			if (call.durationMs !== undefined)
				parts.push(`(${formatDuration(call.durationMs)})`);
			if (call.error) parts.push(`error: ${call.error}`);
			return parts.join(" ");
		});
		sections.push(`## Tool Calls\n\n${bullets.join("\n")}\n`);
	}
	return sections.join("\n");
}

export function writeCronRunReport(options: WriteReportOptions): string {
	const dir = resolveCronReportsDir(options.specs);
	mkdirSync(dir, { recursive: true });
	const path = join(dir, `${options.run.runId}.md`);
	const definition = describeDefinitionSource(options.spec, options.specs);
	const content = `${buildFrontmatter(
		options.run,
		options.spec,
		definition,
		options.data.triggerEvent,
	)}\n${buildHeader(options.run, options.spec, definition, options.data)}\n${buildBody(options.data)}`;
	writeFileSync(path, content, "utf8");
	return path;
}
