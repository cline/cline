import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { ProviderSettingsManager } from "@cline/core";
import type {
	LocalModelDetails,
	LocalModelsStatus,
	LocalRuntime,
} from "../../webview/lib/local-models";

export interface LocalRuntimeBackend {
	/** The runtime provider's saved settings. */
	readSettings(): { baseUrl: string; contextWindow?: number };
	/** Cline can only start, and measure disk space for, a runtime on this machine. */
	isLocal(): boolean;
	isReachable(): Promise<boolean>;
	isInstalled(): Promise<boolean>;
	/** Resolves once the runtime responds, or with false after giving up. */
	start(): Promise<boolean>;
	/** Throws when the runtime can't be reached. */
	readModels(): Promise<Pick<LocalModelsStatus, "installed" | "running">>;
	/** Folders models may be stored in, most likely first. */
	modelDirs(): Promise<string[]>;
	pull(
		model: string,
		onProgress: (progress: {
			status: string;
			completed: number;
			total: number;
		}) => void,
		signal: AbortSignal,
	): Promise<void>;
	load(model: string, contextWindow: number): Promise<void>;
	unload(model: string): Promise<void>;
	delete(model: string): Promise<void>;
	show(model: string): Promise<LocalModelDetails>;
}

export function readProviderSettings(provider: LocalRuntime): {
	baseUrl: string;
	contextWindow?: number;
	apiKey?: string;
} {
	const settings = new ProviderSettingsManager().getProviderSettings(provider);
	return {
		baseUrl: settings?.baseUrl?.trim() ?? "",
		contextWindow: settings?.contextWindow,
		apiKey: settings?.apiKey?.trim() || undefined,
	};
}

/** Chat sends the saved key as a Bearer token, so servers that require one get it here too. */
export function authHeaders(provider: LocalRuntime): Record<string, string> {
	const { apiKey } = readProviderSettings(provider);
	return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

/** The server root, without the API path providers append to the base URL. */
export function toServerUrl(baseUrl: string, fallback: string): string {
	return (
		baseUrl.replace(/\/+$/, "").replace(/\/(?:v1|api(?:\/v\d+)?)$/, "") ||
		fallback
	);
}

export function isLocalUrl(url: string): boolean {
	try {
		const { hostname } = new URL(url);
		return ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(hostname);
	} catch {
		return false;
	}
}

export async function respondsOk(
	url: string,
	headers?: Record<string, string>,
): Promise<boolean> {
	try {
		const response = await fetch(url, {
			headers,
			signal: AbortSignal.timeout(1500),
		});
		return response.ok;
	} catch {
		return false;
	}
}

export async function firstExecutable(
	files: string[],
): Promise<string | undefined> {
	for (const file of files) {
		try {
			await access(file, fsConstants.X_OK);
			return file;
		} catch {}
	}
	return undefined;
}

/** Detached so the runtime keeps serving after Cline quits, like when started by hand. */
export function spawnDetached(
	command: string,
	args: string[],
	env?: Record<string, string>,
): Promise<never> {
	const child = spawn(command, args, {
		env: env ? { ...process.env, ...env } : undefined,
		detached: true,
		stdio: "ignore",
		windowsHide: true,
	});
	const spawnError = new Promise<never>((_, reject) =>
		child.once("error", reject),
	);
	spawnError.catch(() => {});
	child.unref();
	return spawnError;
}

export async function waitUntilReachable(
	backend: Pick<LocalRuntimeBackend, "isReachable">,
	timeoutMs: number,
	spawnError?: Promise<never>,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const reachable = await (spawnError
			? Promise.race([backend.isReachable(), spawnError])
			: backend.isReachable());
		if (reachable) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	return false;
}
