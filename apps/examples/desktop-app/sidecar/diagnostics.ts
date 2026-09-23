import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { arch, homedir, platform, release } from "node:os";
import { join } from "node:path";
import { readGlobalSettings, resolveClineDataDir } from "@cline/core";
import { strToU8, zipSync } from "fflate";
import packageJson from "../package.json";
import { readDesktopSettings } from "./desktop-settings";
import { readSessionManifest } from "./paths";

/** Tail of the sidecar log (`code.log`) included in the bundle. */
export const DIAGNOSTICS_LOG_TAIL_BYTES = 2 * 1024 * 1024;
/** Tail of the hub daemon log; the file itself is unbounded. */
export const DIAGNOSTICS_HUB_LOG_TAIL_LINES = 5_000;
// Enough to cover the line tail without reading the whole hub log.
const HUB_LOG_READ_WINDOW_BYTES = 8 * 1024 * 1024;

const SESSION_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;

export interface DiagnosticsExportInput {
	sessionIds: string[];
	hubUrl?: string | null;
	runningSessionCount?: number;
	cloudAgents?: { available: boolean; enabled: boolean };
	now?: Date;
}

export interface DiagnosticsBundle {
	fileName: string;
	files: Record<string, Uint8Array>;
	sessionIds: string[];
}

// Secrets are never read on purpose (providers.json / secrets.json stay
// out of the bundle), but logs echo request headers and provider configs.
// Blank anything that looks like a credential before it leaves the machine.
const SECRET_FIELD_PATTERN =
	/("?(?:api[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|secret|password|authorization|x-api-key)"?\s*[:=]\s*)("?)([^",}\s]+)\2/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g;
const KEY_PREFIX_PATTERN = /\b(?:sk|pk|rk|xox[abps])-[A-Za-z0-9_-]{8,}/g;

export function redactDiagnosticsText(text: string): string {
	const home = homedir();
	// Bearer first: the field pattern would otherwise treat the word
	// "Bearer" as the value of an `authorization:` header.
	let result = text
		.replace(BEARER_PATTERN, "Bearer <redacted>")
		.replace(SECRET_FIELD_PATTERN, "$1$2<redacted>$2")
		.replace(KEY_PREFIX_PATTERN, "<redacted>");
	if (home) {
		// JSON-encoded Windows paths carry doubled backslashes.
		result = result
			.split(home)
			.join("~")
			.split(home.replaceAll("\\", "\\\\"))
			.join("~");
	}
	return result;
}

function readTailBytes(path: string, maxBytes: number): string | null {
	if (!existsSync(path)) return null;
	let fd: number | undefined;
	try {
		const size = statSync(path).size;
		const length = Math.min(size, maxBytes);
		const buffer = Buffer.alloc(length);
		fd = openSync(path, "r");
		readSync(fd, buffer, 0, length, size - length);
		let text = buffer.toString("utf8");
		if (length < size) {
			// Drop the partial first line so the tail starts on a record boundary.
			const newline = text.indexOf("\n");
			text = newline === -1 ? "" : text.slice(newline + 1);
		}
		return text;
	} catch {
		return null;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

function readTailLines(path: string, maxLines: number): string | null {
	const text = readTailBytes(path, HUB_LOG_READ_WINDOW_BYTES);
	if (text === null) return null;
	const lines = text.split("\n");
	if (lines.at(-1) === "") lines.pop();
	return `${lines.slice(-maxLines).join("\n")}\n`;
}

function sanitizeSessionIds(sessionIds: string[]): string[] {
	return [
		...new Set(
			sessionIds
				.map((id) => id.trim())
				.filter((id) => SESSION_ID_PATTERN.test(id) && !id.includes("..")),
		),
	];
}

function formatStamp(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return (
		`${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
		`-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
	);
}

export function buildDiagnosticsBundle(
	input: DiagnosticsExportInput,
): DiagnosticsBundle {
	const now = input.now ?? new Date();
	const dataDir = resolveClineDataDir();
	const sessionIds = sanitizeSessionIds(input.sessionIds);
	const files: Record<string, string> = {};

	const sidecarLogPath =
		process.env.CLINE_LOG_PATH?.trim() || join(dataDir, "logs", "code.log");
	const sidecarLog = readTailBytes(sidecarLogPath, DIAGNOSTICS_LOG_TAIL_BYTES);
	if (sidecarLog !== null) files["logs/code.log"] = sidecarLog;

	const hubLog = readTailLines(
		join(dataDir, "logs", "hub-daemon.log"),
		DIAGNOSTICS_HUB_LOG_TAIL_LINES,
	);
	if (hubLog !== null) files["logs/hub-daemon.log"] = hubLog;

	const includedSessions: string[] = [];
	for (const sessionId of sessionIds) {
		const manifest = readSessionManifest(sessionId);
		if (!manifest) continue;
		// The system prompt is large and not diagnostic; conversation
		// contents (messages.json) are deliberately never included.
		const metadata =
			manifest.metadata && typeof manifest.metadata === "object"
				? { ...(manifest.metadata as Record<string, unknown>) }
				: undefined;
		if (metadata) delete metadata.systemPrompt;
		files[`sessions/${sessionId}.json`] = `${JSON.stringify(
			{ ...manifest, metadata },
			null,
			2,
		)}\n`;
		includedSessions.push(sessionId);
	}

	const report = {
		generatedAt: now.toISOString(),
		app: {
			name: packageJson.name,
			version: packageJson.version,
		},
		system: {
			platform: platform(),
			arch: arch(),
			osRelease: release(),
			bun: process.versions.bun ?? null,
			node: process.versions.node,
		},
		hubUrl: input.hubUrl ?? null,
		runningSessionCount: input.runningSessionCount ?? null,
		cloudAgents: input.cloudAgents ?? null,
		globalSettings: readGlobalSettings(),
		desktopSettings: readDesktopSettings(),
		dataDir,
		includedSessions,
		includedFiles: Object.keys(files).sort(),
	};
	files["report.json"] = `${JSON.stringify(report, null, 2)}\n`;

	return {
		fileName: `cline-diagnostics-${packageJson.version}-${formatStamp(now)}.zip`,
		files: Object.fromEntries(
			Object.entries(files).map(([name, text]) => [
				name,
				strToU8(redactDiagnosticsText(text)),
			]),
		),
		sessionIds: includedSessions,
	};
}

export function resolveDiagnosticsOutputDir(): string {
	const downloads = join(homedir(), "Downloads");
	return existsSync(downloads)
		? downloads
		: join(resolveClineDataDir(), "diagnostics");
}

export function writeDiagnosticsBundle(
	input: DiagnosticsExportInput,
	outputDir = resolveDiagnosticsOutputDir(),
): { path: string; bytes: number; files: string[]; sessionIds: string[] } {
	const bundle = buildDiagnosticsBundle(input);
	const zipped = zipSync(bundle.files, { level: 6 });
	mkdirSync(outputDir, { recursive: true });
	const path = join(outputDir, bundle.fileName);
	writeFileSync(path, zipped);
	return {
		path,
		bytes: zipped.byteLength,
		files: Object.keys(bundle.files).sort(),
		sessionIds: bundle.sessionIds,
	};
}
