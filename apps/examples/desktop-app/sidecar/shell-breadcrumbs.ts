import { readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	type BasicLogger,
	type ITelemetryService,
	isTelemetryOptedOutGlobally,
	normalizeSdkError,
	type TelemetryProperties,
} from "@cline/core";

/**
 * Reader half of the shell breadcrumb protocol. When the sidecar cannot
 * spawn or dies unexpectedly, no JS process is alive to report telemetry —
 * so the Rust shell (src-tauri/src/main.rs) appends small JSON lines to a
 * breadcrumb file. On the next sidecar boot this module reads the file,
 * reports each valid line as `desktop.shell_breadcrumb`, and truncates the
 * file. Best-effort throughout: malformed lines are dropped silently and
 * nothing here may block or fail startup.
 */

export const DESKTOP_SHELL_BREADCRUMB_EVENT = "desktop.shell_breadcrumb";

const SHELL_COMPONENT = "desktop.shell";

/** Newest lines win when a crash loop filled the file. */
const MAX_REPORTED_BREADCRUMBS = 50;

// The shell caps the file at 64 KiB; anything materially larger was not
// written by the shell, so drop it unparsed.
const MAX_FILE_BYTES = 256 * 1024;

// Breadcrumb event names are the shell's own snake_case identifiers.
const BREADCRUMB_EVENT_PATTERN = /^[a-z0-9_.]{1,64}$/;

/**
 * Must stay in sync with `shell_breadcrumb_path` in src-tauri/src/main.rs,
 * which appends to this file.
 */
export function resolveShellBreadcrumbPath(): string {
	return (
		process.env.CLINE_DESKTOP_BREADCRUMB_PATH?.trim() ||
		join(homedir(), ".cline", "data", "desktop", "shell-breadcrumbs.jsonl")
	);
}

type ParsedBreadcrumb = {
	breadcrumb_event: string;
	occurred_at?: string;
	exit_code?: number;
	restart_count?: number;
	detail?: string;
};

function parseBreadcrumbLine(line: string): ParsedBreadcrumb | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return undefined;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return undefined;
	}
	const record = parsed as Record<string, unknown>;
	const event = record.event;
	if (typeof event !== "string" || !BREADCRUMB_EVENT_PATTERN.test(event)) {
		return undefined;
	}
	const breadcrumb: ParsedBreadcrumb = { breadcrumb_event: event };
	if (typeof record.ts === "number" && Number.isFinite(record.ts)) {
		const occurredAt = new Date(record.ts);
		if (!Number.isNaN(occurredAt.getTime())) {
			breadcrumb.occurred_at = occurredAt.toISOString();
		}
	}
	if (
		typeof record.exit_code === "number" &&
		Number.isFinite(record.exit_code)
	) {
		breadcrumb.exit_code = record.exit_code;
	}
	if (
		typeof record.restart_count === "number" &&
		Number.isFinite(record.restart_count)
	) {
		breadcrumb.restart_count = record.restart_count;
	}
	if (typeof record.detail === "string" && record.detail.length > 0) {
		breadcrumb.detail = record.detail;
	}
	return breadcrumb;
}

/**
 * Reads, reports, and truncates the shell breadcrumb file. Returns how many
 * breadcrumbs were reported. Never throws.
 */
export function reportShellBreadcrumbs(
	telemetry: ITelemetryService | undefined,
	logger?: BasicLogger,
	path: string = resolveShellBreadcrumbPath(),
): number {
	try {
		let size: number;
		try {
			size = statSync(path).size;
		} catch {
			return 0;
		}
		const truncate = () => {
			rmSync(path, { force: true });
		};
		if (size > MAX_FILE_BYTES) {
			truncate();
			return 0;
		}
		const breadcrumbs = readFileSync(path, "utf8")
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map(parseBreadcrumbLine)
			.filter(
				(breadcrumb): breadcrumb is ParsedBreadcrumb =>
					breadcrumb !== undefined,
			)
			.slice(-MAX_REPORTED_BREADCRUMBS);
		// Truncate even when opted out or when nothing parsed: the file must
		// not accumulate across launches.
		truncate();
		if (
			breadcrumbs.length === 0 ||
			!telemetry ||
			isTelemetryOptedOutGlobally()
		) {
			return 0;
		}
		for (const breadcrumb of breadcrumbs) {
			const properties: TelemetryProperties = {
				component: SHELL_COMPONENT,
				breadcrumb_event: breadcrumb.breadcrumb_event,
			};
			if (breadcrumb.occurred_at !== undefined) {
				properties.occurred_at = breadcrumb.occurred_at;
			}
			if (breadcrumb.exit_code !== undefined) {
				properties.exit_code = breadcrumb.exit_code;
			}
			if (breadcrumb.restart_count !== undefined) {
				properties.restart_count = breadcrumb.restart_count;
			}
			if (breadcrumb.detail !== undefined) {
				// Spawn-failure details can contain filesystem paths; run them
				// through the shared redaction before they leave the machine.
				properties.detail = normalizeSdkError({
					message: breadcrumb.detail,
				}).error_message;
			}
			telemetry.capture({
				event: DESKTOP_SHELL_BREADCRUMB_EVENT,
				properties,
			});
		}
		logger?.log("Reported shell breadcrumbs", { count: breadcrumbs.length });
		return breadcrumbs.length;
	} catch (error) {
		logger?.debug?.("Failed to report shell breadcrumbs", { error });
		return 0;
	}
}
