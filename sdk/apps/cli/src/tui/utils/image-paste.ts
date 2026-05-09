import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { release, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	bufferToImageDataUrl,
	isImagePath,
	loadImageAsDataUrl,
} from "../../utils/image-attachments";

const COMMAND_TIMEOUT_MS = 1500;
const MAX_CLIPBOARD_BYTES = 20 * 1024 * 1024;
const PASTE_DECODER = new TextDecoder();
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI_SEQUENCE_PATTERN = new RegExp(
	`${ESC}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}]*(?:${BEL}|${ESC}\\\\))`,
	"g",
);

interface PasteLikeEvent {
	bytes: Uint8Array;
	metadata?: {
		mimeType?: string;
	};
}

export interface ImagePasteAttachment {
	dataUrl: string;
	source: "clipboard" | "path" | "paste";
}

function normalizePasteText(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function decodePasteBytes(bytes: Uint8Array): string {
	return PASTE_DECODER.decode(bytes);
}

function stripAnsiSequences(text: string): string {
	return text.replace(ANSI_SEQUENCE_PATTERN, "");
}

function stripWrappingQuotes(text: string): string {
	return text.replace(/^['"]+|['"]+$/g, "");
}

function unescapeTerminalPath(text: string): string {
	if (process.platform === "win32") {
		return text;
	}
	return text.replace(/\\(.)/g, "$1");
}

export function resolvePastedImagePath(text: string): string | undefined {
	const normalized = normalizePasteText(text).trim();
	if (!normalized) {
		return undefined;
	}

	const lines = normalized.split("\n").filter((line) => line.trim().length > 0);
	if (lines.length !== 1) {
		return undefined;
	}

	const raw = stripWrappingQuotes(lines[0]?.trim() ?? "");
	if (!raw || /^(https?):\/\//i.test(raw)) {
		return undefined;
	}

	if (raw.startsWith("file://")) {
		try {
			return fileURLToPath(raw);
		} catch {
			return undefined;
		}
	}

	return unescapeTerminalPath(raw);
}

export function readImageDataUrlFromPastedText(
	text: string,
): ImagePasteAttachment | undefined {
	const filePath = resolvePastedImagePath(text);
	if (!filePath || !isImagePath(filePath)) {
		return undefined;
	}

	try {
		return {
			dataUrl: loadImageAsDataUrl(filePath),
			source: "path",
		};
	} catch {
		return undefined;
	}
}

async function runCommand(
	command: string,
	args: string[],
): Promise<Buffer | undefined> {
	return await new Promise((resolve) => {
		const child = spawn(command, args, {
			stdio: ["ignore", "pipe", "ignore"],
		});
		const chunks: Buffer[] = [];
		let total = 0;
		let settled = false;

		const finish = (buffer: Buffer | undefined) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(buffer);
		};

		const timer = setTimeout(() => {
			child.kill();
			finish(undefined);
		}, COMMAND_TIMEOUT_MS);

		child.on("error", () => finish(undefined));
		child.stdout.on("data", (chunk: Buffer) => {
			total += chunk.length;
			if (total > MAX_CLIPBOARD_BYTES) {
				child.kill();
				finish(undefined);
				return;
			}
			chunks.push(chunk);
		});
		child.on("close", (code) => {
			if (code !== 0 || chunks.length === 0) {
				finish(undefined);
				return;
			}
			finish(Buffer.concat(chunks));
		});
	});
}

async function readMacClipboardImage(): Promise<string | undefined> {
	const dir = await mkdtemp(join(tmpdir(), "cline-clipboard-"));
	const filePath = join(dir, "clipboard.png");
	try {
		const escapedPath = filePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
		await runCommand("osascript", [
			"-e",
			'set imageData to the clipboard as "PNGf"',
			"-e",
			`set fileRef to open for access POSIX file "${escapedPath}" with write permission`,
			"-e",
			"set eof fileRef to 0",
			"-e",
			"write imageData to fileRef",
			"-e",
			"close access fileRef",
		]);
		const buffer = await readFile(filePath).catch(() => undefined);
		if (!buffer || buffer.length === 0) {
			return undefined;
		}
		return bufferToImageDataUrl(buffer, "image/png");
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
}

async function readWindowsClipboardImage(): Promise<string | undefined> {
	const script =
		"Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img) { $ms = New-Object System.IO.MemoryStream; $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); [System.Convert]::ToBase64String($ms.ToArray()) }";
	const output = await runCommand("powershell.exe", [
		"-NonInteractive",
		"-NoProfile",
		"-Command",
		script,
	]);
	const base64 = output?.toString("utf8").trim();
	if (!base64) {
		return undefined;
	}
	const buffer = Buffer.from(base64, "base64");
	if (buffer.length === 0) {
		return undefined;
	}
	return bufferToImageDataUrl(buffer, "image/png");
}

async function readLinuxClipboardImage(): Promise<string | undefined> {
	const wayland = await runCommand("wl-paste", ["-t", "image/png"]);
	if (wayland && wayland.length > 0) {
		return bufferToImageDataUrl(wayland, "image/png");
	}

	const x11 = await runCommand("xclip", [
		"-selection",
		"clipboard",
		"-t",
		"image/png",
		"-o",
	]);
	if (x11 && x11.length > 0) {
		return bufferToImageDataUrl(x11, "image/png");
	}

	return undefined;
}

export async function readClipboardImageDataUrl(): Promise<string | undefined> {
	if (process.platform === "darwin") {
		return await readMacClipboardImage();
	}

	if (process.platform === "win32" || release().includes("WSL")) {
		const windowsImage = await readWindowsClipboardImage();
		if (windowsImage) {
			return windowsImage;
		}
	}

	if (process.platform === "linux") {
		return await readLinuxClipboardImage();
	}

	return undefined;
}

export function readImmediateImagePasteAttachment(
	event: PasteLikeEvent,
): ImagePasteAttachment | undefined {
	const mimeType = event.metadata?.mimeType;
	if (mimeType?.startsWith("image/") && event.bytes.length > 0) {
		return {
			dataUrl: bufferToImageDataUrl(Buffer.from(event.bytes), mimeType),
			source: "paste",
		};
	}

	const text = normalizePasteText(
		stripAnsiSequences(decodePasteBytes(event.bytes)),
	);
	return readImageDataUrlFromPastedText(text);
}

export async function readImagePasteAttachment(
	event: PasteLikeEvent,
): Promise<ImagePasteAttachment | undefined> {
	const immediate = readImmediateImagePasteAttachment(event);
	if (immediate) {
		return immediate;
	}

	const text = normalizePasteText(
		stripAnsiSequences(decodePasteBytes(event.bytes)),
	);

	if (text.trim()) {
		return undefined;
	}

	const dataUrl = await readClipboardImageDataUrl();
	if (!dataUrl) {
		return undefined;
	}

	return {
		dataUrl,
		source: "clipboard",
	};
}
