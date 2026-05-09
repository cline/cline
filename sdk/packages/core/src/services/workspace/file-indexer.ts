import { spawn } from "node:child_process";
import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { isMainThread, parentPort, Worker } from "node:worker_threads";

const DEFAULT_INDEX_TTL_MS = 15_000;
const STALE_CACHE_EVICTION_MS = 10 * 60_000;
const WORKER_INDEX_REQUEST_TIMEOUT_MS = 1_000;
const DEFAULT_EXCLUDE_DIRS = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	".next",
	"coverage",
	".turbo",
	".cache",
	"target",
	"out",
]);

function shouldSkipWalkError(error: unknown): boolean {
	const code =
		error && typeof error === "object" && "code" in error
			? String((error as { code?: unknown }).code ?? "")
			: "";
	return code === "EACCES" || code === "EPERM" || code === "ENOENT";
}

interface CacheEntry {
	files: Set<string>;
	lastBuiltAt: number;
	lastAccessedAt: number;
	pending: Promise<Set<string>> | null;
}

export interface FastFileIndexOptions {
	ttlMs?: number;
}

interface IndexRequestMessage {
	type: "index";
	requestId: number;
	cwd: string;
}

interface IndexResponseMessage {
	type: "indexResult";
	requestId: number;
	files?: string[];
	error?: string;
}

const CACHE = new Map<string, CacheEntry>();

function pruneStaleCacheEntries(now: number): void {
	if (CACHE.size <= 1) {
		return;
	}
	for (const [cwd, entry] of CACHE.entries()) {
		if (entry.pending) {
			continue;
		}
		if (now - entry.lastAccessedAt > STALE_CACHE_EVICTION_MS) {
			CACHE.delete(cwd);
		}
	}
}

function toPosixRelative(cwd: string, absolutePath: string): string {
	return path.relative(cwd, absolutePath).split(path.sep).join("/");
}

async function listFilesWithRg(cwd: string): Promise<Set<string>> {
	const output = await new Promise<string>((resolve, reject) => {
		const child = spawn("rg", ["--files", "--hidden", "-g", "!.git"], {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (chunk: Buffer | string) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer | string) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("close", (code: number | null) => {
			if (code === 0) {
				resolve(stdout);
				return;
			}
			reject(new Error(stderr || `rg exited with code ${code}`));
		});
	});

	const files = output
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => line.replace(/\\/g, "/"));

	return new Set(files);
}

async function walkDir(
	cwd: string,
	dir: string,
	files: Set<string>,
): Promise<void> {
	let entries: Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch (error) {
		if (shouldSkipWalkError(error)) {
			return;
		}
		throw error;
	}
	for (const entry of entries) {
		const absolutePath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (DEFAULT_EXCLUDE_DIRS.has(entry.name)) {
				continue;
			}
			try {
				await walkDir(cwd, absolutePath, files);
			} catch (error) {
				if (shouldSkipWalkError(error)) {
					continue;
				}
				throw error;
			}
			continue;
		}
		if (entry.isFile()) {
			files.add(toPosixRelative(cwd, absolutePath));
		}
	}
}

async function listFilesFallback(cwd: string): Promise<Set<string>> {
	const files = new Set<string>();
	await walkDir(cwd, cwd, files);
	return files;
}

async function buildIndex(cwd: string): Promise<Set<string>> {
	try {
		return await listFilesWithRg(cwd);
	} catch {
		return listFilesFallback(cwd);
	}
}

function startWorkerServer(): void {
	if (isMainThread || !parentPort) {
		return;
	}
	const port = parentPort;

	port.on("message", (message: IndexRequestMessage) => {
		if (message.type !== "index") {
			return;
		}

		void buildIndex(message.cwd)
			.then((files) => {
				const response: IndexResponseMessage = {
					type: "indexResult",
					requestId: message.requestId,
					files: Array.from(files),
				};
				port.postMessage(response);
			})
			.catch((error: unknown) => {
				const response: IndexResponseMessage = {
					type: "indexResult",
					requestId: message.requestId,
					error:
						error instanceof Error
							? error.message
							: "Failed to build file index",
				};
				port.postMessage(response);
			});
	});
}

class FileIndexWorkerClient {
	private readonly worker = new Worker(new URL(import.meta.url));
	private nextRequestId = 0;
	private pending = new Map<
		number,
		{
			resolve: (files: string[]) => void;
			reject: (reason: Error) => void;
		}
	>();

	constructor() {
		// Keep indexing opportunistic: this worker should never block process exit.
		this.worker.unref();
		this.worker.on("message", (message: IndexResponseMessage) => {
			if (message.type !== "indexResult") {
				return;
			}
			const request = this.pending.get(message.requestId);
			if (!request) {
				return;
			}
			this.pending.delete(message.requestId);
			if (message.error) {
				request.reject(new Error(message.error));
				return;
			}
			request.resolve(message.files ?? []);
		});

		this.worker.on("error", (error: Error) => {
			this.flushPending(error);
		});

		this.worker.on("exit", (code) => {
			if (code !== 0) {
				this.flushPending(
					new Error(`File index worker exited with code ${code}`),
				);
			}
		});
	}

	requestIndex(cwd: string): Promise<string[]> {
		const requestId = ++this.nextRequestId;
		const result = new Promise<string[]>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(requestId);
				reject(new Error("Timed out waiting for file index worker response"));
			}, WORKER_INDEX_REQUEST_TIMEOUT_MS);
			timeout.unref();
			this.pending.set(requestId, {
				resolve: (files) => {
					clearTimeout(timeout);
					resolve(files);
				},
				reject: (reason) => {
					clearTimeout(timeout);
					reject(reason);
				},
			});
		});

		const message: IndexRequestMessage = {
			type: "index",
			requestId,
			cwd,
		};
		this.worker.postMessage(message);
		return result;
	}

	private flushPending(error: Error): void {
		for (const [requestId, request] of this.pending.entries()) {
			request.reject(error);
			this.pending.delete(requestId);
		}
	}
}

startWorkerServer();

let workerClient: FileIndexWorkerClient | null | undefined;

function getWorkerClient(): FileIndexWorkerClient | null {
	if (!isMainThread) {
		return null;
	}
	if (workerClient === undefined) {
		workerClient = new FileIndexWorkerClient();
	}
	return workerClient;
}

async function buildIndexInBackground(cwd: string): Promise<Set<string>> {
	const workerClient = getWorkerClient();
	if (!workerClient) {
		return buildIndex(cwd);
	}

	try {
		const files = await workerClient.requestIndex(cwd);
		return new Set(files);
	} catch {
		return buildIndex(cwd);
	}
}

export async function getFileIndex(
	cwd: string,
	options: FastFileIndexOptions = {},
): Promise<Set<string>> {
	const ttlMs = options.ttlMs ?? DEFAULT_INDEX_TTL_MS;
	const now = Date.now();
	pruneStaleCacheEntries(now);
	const existing = CACHE.get(cwd);

	if (
		existing &&
		ttlMs > 0 &&
		now - existing.lastBuiltAt <= ttlMs &&
		existing.files.size > 0
	) {
		existing.lastAccessedAt = now;
		return existing.files;
	}

	if (existing?.pending) {
		existing.lastAccessedAt = now;
		return existing.pending;
	}

	const pending = buildIndexInBackground(cwd).then((files) => {
		CACHE.set(cwd, {
			files,
			lastBuiltAt: Date.now(),
			lastAccessedAt: Date.now(),
			pending: null,
		});
		return files;
	});

	CACHE.set(cwd, {
		files: existing?.files ?? new Set<string>(),
		lastBuiltAt: existing?.lastBuiltAt ?? 0,
		lastAccessedAt: now,
		pending,
	});

	return pending;
}

export async function prewarmFileIndex(
	cwd: string,
	options: FastFileIndexOptions = {},
): Promise<void> {
	await getFileIndex(cwd, { ...options, ttlMs: 0 });
}
