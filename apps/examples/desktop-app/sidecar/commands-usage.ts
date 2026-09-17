import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import { UsagePatternsService } from "@cline/core";
import type { JsonRecord, SidecarContext } from "./types";

const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 90;
/** A 2400x1350 card is far under this; the cap only stops absurd payloads. */
const MAX_SHARE_CARD_BYTES = 12 * 1024 * 1024;
const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
/** Exported cards always carry this prefix, which is what reveal checks for. */
const SHARE_CARD_PREFIX = "cline-usage-";
const MAX_NAME_ATTEMPTS = 100;

export const USAGE_COMMANDS = [
	"get_usage_patterns",
	"export_usage_share_card",
	"reveal_usage_share_card",
] as const;

export type UsageCommand = (typeof USAGE_COMMANDS)[number];

/**
 * The pattern scan caches briefly: the Usage settings tab re-reads on mount,
 * on range change and on manual refresh, and a full scan walks every session
 * directory on the machine.
 */
let service: UsagePatternsService | undefined;

function patternsService(): UsagePatternsService {
	service ??= new UsagePatternsService();
	return service;
}

function clampRangeDays(value: unknown): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return DEFAULT_RANGE_DAYS;
	return Math.min(MAX_RANGE_DAYS, Math.max(1, Math.round(parsed)));
}

function argRecord(args: unknown): JsonRecord {
	return args && typeof args === "object" ? (args as JsonRecord) : {};
}

function downloadsDir(): string {
	return join(homedir(), "Downloads");
}

function decodeShareCardPng(dataUrl: unknown): Buffer {
	if (typeof dataUrl !== "string" || !dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
		throw new Error("share card must be a base64 PNG data URL");
	}
	const base64 = dataUrl.slice(PNG_DATA_URL_PREFIX.length);
	// Checked on the encoded length so an oversized payload is never decoded.
	if (
		base64.length === 0 ||
		base64.length > Math.ceil(MAX_SHARE_CARD_BYTES / 3) * 4
	) {
		throw new Error("share card payload is empty or too large");
	}
	const png = Buffer.from(base64, "base64");
	if (!png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
		throw new Error("share card payload is not a PNG image");
	}
	return png;
}

/** Keeps only a safe stem and forces the share-card prefix. */
function shareCardStem(value: unknown): string {
	const cleaned = (typeof value === "string" ? value : "")
		.replace(/\.png$/i, "")
		.replace(/[^a-zA-Z0-9._-]+/g, "-")
		// Strip leading dots too: "..-..-etc-passwd" must not survive as a name.
		.replace(/^[.-]+/, "")
		.replace(/[.-]+$/, "");
	if (cleaned.startsWith(SHARE_CARD_PREFIX)) return cleaned;
	return `${SHARE_CARD_PREFIX}${cleaned || Date.now()}`;
}

/** Never overwrites: a second export of the same day gets a numbered name. */
function writeNewFile(dir: string, stem: string, data: Buffer): string {
	for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt += 1) {
		const target = join(
			dir,
			attempt === 1 ? `${stem}.png` : `${stem}-${attempt}.png`,
		);
		try {
			writeFileSync(target, data, { flag: "wx" });
			return target;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	}
	throw new Error("no free file name for the share card in Downloads");
}

/**
 * Writes a share card rendered by the webview into the user's Downloads folder.
 *
 * The card is built entirely on-device from aggregate session metadata. This
 * command only writes the PNG the user asked to save — there is no upload path,
 * and nothing leaves the machine.
 */
function exportShareCard(input: JsonRecord): {
	path: string;
	platform: NodeJS.Platform;
} {
	const png = decodeShareCardPng(input.png);
	const dir = downloadsDir();
	mkdirSync(dir, { recursive: true });
	return {
		path: writeNewFile(dir, shareCardStem(input.fileName), png),
		platform: process.platform,
	};
}

/** Reveal is limited to cards this feature exported, not arbitrary paths. */
function exportedShareCardPath(value: unknown): string {
	if (typeof value !== "string" || !isAbsolute(value)) {
		throw new Error("path must be absolute");
	}
	const target = resolve(value);
	const fromDownloads = relative(downloadsDir(), target);
	const name = basename(target);
	if (
		isAbsolute(fromDownloads) ||
		dirname(fromDownloads) !== "." ||
		!name.startsWith(SHARE_CARD_PREFIX) ||
		!name.endsWith(".png")
	) {
		throw new Error("only exported share cards can be revealed");
	}
	if (!existsSync(target)) throw new Error("the share card no longer exists");
	return target;
}

/** Selects the file in the platform's file manager rather than opening it. */
function revealInFileManager(target: string): void {
	const [command, args]: [string, string[]] =
		process.platform === "darwin"
			? ["open", ["-R", target]]
			: process.platform === "win32"
				? // Explorer only parses /select when just the path is quoted.
					["explorer.exe", [`/select,"${target}"`]]
				: ["xdg-open", [dirname(target)]];
	const child = spawn(command, args, {
		stdio: "ignore",
		detached: true,
		windowsVerbatimArguments: process.platform === "win32",
	});
	// An unhandled child error event would crash the sidecar process.
	child.once("error", () => {});
	child.unref();
}

/**
 * Local usage-pattern commands (Settings → Usage).
 *
 * Reads only session metadata, so this never returns transcript content and
 * never needs the multi-gigabyte parse path.
 */
export async function handleUsageCommand(
	_ctx: SidecarContext,
	command: UsageCommand,
	args?: unknown,
): Promise<unknown> {
	const input = argRecord(args);
	switch (command) {
		case "get_usage_patterns": {
			const patterns = patternsService();
			if (input.refresh === true) patterns.invalidate();
			return await patterns.read(clampRangeDays(input.rangeDays));
		}
		case "export_usage_share_card":
			return exportShareCard(input);
		case "reveal_usage_share_card":
			revealInFileManager(exportedShareCardPath(input.path));
			return { revealed: true };
		default:
			throw new Error(`unknown usage command: ${String(command)}`);
	}
}
