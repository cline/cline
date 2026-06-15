import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join } from "node:path";

/**
 * Generic helpers shared by the single-source install commands
 * (`cline plugin install`, `cline agent install`).
 */

export function resolveHomePath(value: string): string {
	if (value === "~") {
		return homedir();
	}
	if (value.startsWith("~/")) {
		return join(homedir(), value.slice(2));
	}
	return value;
}

export function hashSource(source: string): string {
	return createHash("sha256").update(source).digest("hex").slice(0, 12);
}

export function sanitizeSegment(value: string, fallback = "plugin"): string {
	const sanitized = value
		.replace(/^@/, "")
		.replace(/[^a-zA-Z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	return sanitized || fallback;
}

export function isOfficialRegistrySlug(source: string): boolean {
	return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.trim());
}

export function isLocalPathLike(source: string): boolean {
	return (
		source.startsWith(".") ||
		source.startsWith("/") ||
		source === "~" ||
		source.startsWith("~/") ||
		/^[A-Za-z]:[\\/]|^\\\\/.test(source)
	);
}

export async function runCommand(
	command: string,
	args: string[],
	options: { cwd?: string } = {},
): Promise<void> {
	await new Promise<void>((resolvePromise, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			stdio: ["ignore", "ignore", "pipe"],
			env: process.env,
			// Prevent a console window from flashing on Windows.
			windowsHide: true,
		});
		let stderr = "";
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolvePromise();
				return;
			}
			const details = stderr.trim();
			reject(
				new Error(
					`${command} ${args.join(" ")} failed with exit code ${code}${details ? `: ${details}` : ""}`,
				),
			);
		});
	});
}

function decodePathSegment(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function filenameFromUrlPath(pathname: string, fallback: string): string {
	const filename = basename(decodePathSegment(pathname));
	return filename || fallback;
}

function isGitHubFilePath(pathname: string): boolean {
	const parts = pathname.split("/").filter(Boolean);
	return parts.length >= 5 && (parts[2] === "blob" || parts[2] === "raw");
}

export interface NormalizeRemoteSingleFileUrlOptions {
	/** Whether the URL's filename has an expected extension for this kind. */
	isExpectedFile: (filename: string) => boolean;
	/** Short noun for error messages, e.g. "plugin" or "agent profile". */
	kind: string;
	/** Human label of accepted extensions, e.g. ".js or .ts". */
	extensionsLabel: string;
	/** Fallback filename when the URL path has none. */
	fallbackFilename: string;
}

/**
 * Validates an https single-file URL, rewriting GitHub blob/raw page URLs to
 * raw.githubusercontent.com. Returns null when the source is not a candidate
 * file URL for this kind; throws when it is but violates a constraint.
 */
export function normalizeRemoteSingleFileUrl(
	source: string,
	options: NormalizeRemoteSingleFileUrlOptions,
): { url: string; filename: string } | null {
	if (!/^https?:\/\//i.test(source)) {
		return null;
	}
	let parsed: URL;
	try {
		parsed = new URL(source);
	} catch {
		return null;
	}

	const host = parsed.hostname.toLowerCase();
	const filename = filenameFromUrlPath(
		parsed.pathname,
		options.fallbackFilename,
	);
	const isExpectedFile = options.isExpectedFile(filename);
	const isGitHubFile =
		(host === "github.com" || host === "www.github.com") &&
		isGitHubFilePath(parsed.pathname);

	if (parsed.protocol !== "https:") {
		if (
			isGitHubFile ||
			host === "raw.githubusercontent.com" ||
			isExpectedFile
		) {
			throw new Error(
				`Remote ${options.kind} file URLs must use https: ${source}`,
			);
		}
		return null;
	}

	if (host === "github.com" || host === "www.github.com") {
		const parts = parsed.pathname.split("/").filter(Boolean);
		if (!isGitHubFile) {
			return null;
		}
		if (!isExpectedFile) {
			throw new Error(
				`Remote ${options.kind} file must be ${options.extensionsLabel}: ${source}`,
			);
		}
		const rawParts = [parts[0], parts[1], ...parts.slice(3)];
		return {
			url: `https://raw.githubusercontent.com/${rawParts.join("/")}`,
			filename,
		};
	}

	if (host === "raw.githubusercontent.com") {
		if (!isExpectedFile) {
			throw new Error(
				`Remote ${options.kind} file must be ${options.extensionsLabel}: ${source}`,
			);
		}
		return { url: parsed.toString(), filename };
	}

	if (!isExpectedFile) {
		return null;
	}
	return { url: parsed.toString(), filename };
}

export interface DownloadRemoteFileOptions {
	timeoutMs: number;
	maxBytes: number;
	/** Short noun for error messages, e.g. "plugin" or "agent profile". */
	kind: string;
}

function sizeLimitError(
	url: string,
	options: DownloadRemoteFileOptions,
): Error {
	return new Error(
		`Remote ${options.kind} file from ${url} exceeds the ${options.maxBytes} byte limit`,
	);
}

function getContentLength(response: Response): number | undefined {
	const raw = response.headers.get("content-length");
	if (!raw) {
		return undefined;
	}
	const value = Number(raw);
	if (!Number.isFinite(value) || value < 0) {
		return undefined;
	}
	return value;
}

async function readRemoteBody(
	response: Response,
	url: string,
	options: DownloadRemoteFileOptions,
): Promise<Buffer> {
	const contentLength = getContentLength(response);
	if (contentLength !== undefined && contentLength > options.maxBytes) {
		throw sizeLimitError(url, options);
	}

	if (!response.body) {
		const body = Buffer.from(await response.text(), "utf8");
		if (body.byteLength > options.maxBytes) {
			throw sizeLimitError(url, options);
		}
		return body;
	}

	const reader = response.body.getReader();
	const chunks: Buffer[] = [];
	let received = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			const chunk = Buffer.from(value);
			received += chunk.byteLength;
			if (received > options.maxBytes) {
				await reader.cancel().catch(() => undefined);
				throw sizeLimitError(url, options);
			}
			chunks.push(chunk);
		}
		return Buffer.concat(chunks, received);
	} finally {
		reader.releaseLock();
	}
}

export async function downloadRemoteFile(
	url: string,
	options: DownloadRemoteFileOptions,
): Promise<Buffer> {
	const controller = new AbortController();
	const timeout = setTimeout(() => {
		controller.abort();
	}, options.timeoutMs);
	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) {
			const suffix = response.statusText ? ` ${response.statusText}` : "";
			throw new Error(
				`Failed to download ${options.kind} file from ${url}: ${response.status}${suffix}`,
			);
		}
		return await readRemoteBody(response, url, options);
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			throw new Error(
				`Timed out downloading ${options.kind} file from ${url} after ${options.timeoutMs}ms`,
			);
		}
		throw error;
	} finally {
		clearTimeout(timeout);
	}
}
