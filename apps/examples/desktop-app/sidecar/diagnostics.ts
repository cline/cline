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
import packageJson from "../package.json";
import { readDesktopSettings } from "./desktop-settings";
import { readSessionManifest } from "./paths";

/** How much of each log file (from the end) is included in the report. */
export const DIAGNOSTICS_LOG_TAIL_BYTES = 2 * 1024 * 1024;

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

// providers.json / secrets.json are never read, but blank anything
// credential-shaped that shows up in logs or settings as cheap insurance.
// Matching the bare suffix also covers access_token, client_secret, etc.
const SECRET_FIELD_PATTERN =
	/((?:api[_-]?key|token|secret|password|authorization)"?\s*[:=]\s*"?)([^",}\s]+)/gi;

export function redactDiagnosticsText(text: string): string {
	const home = homedir();
	let result = text.replace(SECRET_FIELD_PATTERN, "$1<redacted>");
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

function readTail(path: string, maxBytes: number): string | null {
	if (!existsSync(path)) return null;
	let fd: number | undefined;
	try {
		const size = statSync(path).size;
		const length = Math.min(size, maxBytes);
		const buffer = Buffer.alloc(length);
		fd = openSync(path, "r");
		readSync(fd, buffer, 0, length, size - length);
		const text = buffer.toString("utf8");
		if (length === size) return text;
		// Drop the partial first line so the tail starts on a record boundary.
		const newline = text.indexOf("\n");
		return newline === -1 ? "" : text.slice(newline + 1);
	} catch {
		return null;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

function formatStamp(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return (
		`${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
		`-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
	);
}

function section(title: string, body: string): string {
	return `\n===== ${title} =====\n${body.endsWith("\n") ? body : `${body}\n`}`;
}

export function buildDiagnosticsReport(
	sessionIds: string[],
	now = new Date(),
): { text: string; sessionIds: string[] } {
	const dataDir = resolveClineDataDir();
	const report = {
		generatedAt: now.toISOString(),
		app: { name: packageJson.name, version: packageJson.version },
		system: {
			platform: platform(),
			arch: arch(),
			osRelease: release(),
			bun: process.versions.bun ?? null,
		},
		dataDir,
		globalSettings: readGlobalSettings(),
		desktopSettings: readDesktopSettings(),
	};
	let text = `${JSON.stringify(report, null, 2)}\n`;

	const logs = [
		process.env.CLINE_LOG_PATH?.trim() || join(dataDir, "logs", "code.log"),
		join(dataDir, "logs", "hub-daemon.log"),
	];
	for (const path of logs) {
		const tail = readTail(path, DIAGNOSTICS_LOG_TAIL_BYTES);
		if (tail !== null) text += section(`tail of ${path}`, tail);
	}

	const includedSessions: string[] = [];
	for (const sessionId of new Set(sessionIds)) {
		if (!SESSION_ID_PATTERN.test(sessionId)) continue;
		const manifest = readSessionManifest(sessionId);
		if (!manifest) continue;
		// Keep the manifest (title, provider, model, cwd, status…) but not the
		// prompt text. Conversation contents (messages.json) are never read.
		const { prompt: _prompt, ...rest } = manifest;
		const metadata =
			rest.metadata && typeof rest.metadata === "object"
				? { ...(rest.metadata as Record<string, unknown>) }
				: undefined;
		if (metadata) {
			delete metadata.prompt;
			delete metadata.systemPrompt;
		}
		text += section(
			`session ${sessionId}`,
			JSON.stringify({ ...rest, metadata }, null, 2),
		);
		includedSessions.push(sessionId);
	}

	return { text: redactDiagnosticsText(text), sessionIds: includedSessions };
}

export function resolveDiagnosticsOutputDir(): string {
	const downloads = join(homedir(), "Downloads");
	return existsSync(downloads)
		? downloads
		: join(resolveClineDataDir(), "diagnostics");
}

export function writeDiagnosticsReport(
	sessionIds: string[],
	outputDir = resolveDiagnosticsOutputDir(),
): { path: string; sessionIds: string[] } {
	const now = new Date();
	const report = buildDiagnosticsReport(sessionIds, now);
	mkdirSync(outputDir, { recursive: true });
	const path = join(
		outputDir,
		`cline-diagnostics-${packageJson.version}-${formatStamp(now)}.txt`,
	);
	writeFileSync(path, report.text);
	return { path, sessionIds: report.sessionIds };
}
