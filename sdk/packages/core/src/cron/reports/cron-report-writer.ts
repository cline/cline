import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type ResolveCronSpecsDirOptions,
	resolveCronReportsDir,
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

function buildFrontmatter(
	run: CronRunRecord,
	spec: CronSpecRecord,
	triggerEvent?: CronEventLogRecord,
): string {
	const entries: string[] = [
		`runId: ${escapeYamlString(run.runId)}`,
		`specId: ${escapeYamlString(spec.specId)}`,
		`externalId: ${escapeYamlString(spec.externalId)}`,
		`title: ${escapeYamlString(spec.title)}`,
		`triggerKind: ${escapeYamlString(run.triggerKind)}`,
		`status: ${escapeYamlString(run.status)}`,
		`sourcePath: ${escapeYamlString(spec.sourcePath)}`,
	];
	const optional = [
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
		sections.push(`## Error\n\n${data.error}\n`);
	}
	if (data.finalText && data.finalText.trim().length > 0) {
		sections.push(`## Summary\n\n${data.finalText.trim()}\n`);
	}
	if (data.usage) {
		const u = data.usage;
		const lines = [
			u.inputTokens !== undefined ? `- inputTokens: ${u.inputTokens}` : "",
			u.outputTokens !== undefined ? `- outputTokens: ${u.outputTokens}` : "",
			u.cacheReadTokens !== undefined
				? `- cacheReadTokens: ${u.cacheReadTokens}`
				: "",
			u.cacheWriteTokens !== undefined
				? `- cacheWriteTokens: ${u.cacheWriteTokens}`
				: "",
			u.totalCost !== undefined ? `- totalCostUsd: ${u.totalCost}` : "",
			data.durationMs !== undefined ? `- durationMs: ${data.durationMs}` : "",
		].filter((line) => line.length > 0);
		if (lines.length > 0) {
			sections.push(`## Usage\n\n${lines.join("\n")}\n`);
		}
	}
	if (data.toolCalls && data.toolCalls.length > 0) {
		const bullets = data.toolCalls.map((call) => {
			const parts = [`- ${call.name}`];
			if (call.durationMs !== undefined) parts.push(`(${call.durationMs}ms)`);
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
	const content = `${buildFrontmatter(
		options.run,
		options.spec,
		options.data.triggerEvent,
	)}\n${buildBody(options.data)}`;
	writeFileSync(path, content, "utf8");
	return path;
}
