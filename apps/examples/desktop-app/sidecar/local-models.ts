import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import { ProviderSettingsManager } from "@cline/core";
import { Ollama } from "ollama";
import {
	type LocalHardwareInfo,
	type LocalModelsStatus,
	OLLAMA_PULL_PROGRESS_EVENT,
	type OllamaPullProgress,
} from "../webview/lib/local-models";
import { broadcastEvent } from "./context";
import type { SidecarContext } from "./types";

const execFileAsync = promisify(execFile);
const BYTES_PER_GB = 1024 ** 3;
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const PROGRESS_THROTTLE_MS = 250;

export const LOCAL_MODELS_COMMANDS = new Set([
	"get_local_models_status",
	"pull_ollama_model",
	"cancel_ollama_pull",
	"load_ollama_model",
	"unload_ollama_model",
	"delete_ollama_model",
]);

let hardwarePromise: Promise<LocalHardwareInfo> | undefined;

// Downloads outlive the settings page that started them (an 18 GB pull takes a
// while), so they are tracked here and progress is broadcast to every window.
const activePulls = new Map<
	string,
	{ progress: OllamaPullProgress; abort: () => void }
>();

async function detectNvidiaGpus(): Promise<LocalHardwareInfo["gpus"]> {
	try {
		const { stdout } = await execFileAsync(
			"nvidia-smi",
			["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
			{ timeout: 3000, windowsHide: true },
		);
		return stdout
			.split("\n")
			.map((line) => line.split(",").map((part) => part.trim()))
			.filter(([name, memoryMib]) => name && Number(memoryMib) > 0)
			.map(([name, memoryMib]) => ({
				name,
				memoryGb: Number(memoryMib) / 1024,
			}));
	} catch {
		return [];
	}
}

async function detectHardware(): Promise<LocalHardwareInfo> {
	const platform = os.platform();
	const arch = os.arch();
	const cpus = os.cpus();
	// Apple Silicon GPUs share system memory, so there is no separate VRAM to query.
	const unifiedMemory = platform === "darwin" && arch === "arm64";
	return {
		platform,
		arch,
		cpuModel: cpus[0]?.model.trim() ?? "",
		cpuCores: cpus.length,
		totalMemoryGb: os.totalmem() / BYTES_PER_GB,
		unifiedMemory,
		gpus: unifiedMemory ? [] : await detectNvidiaGpus(),
	};
}

function readOllamaSettings(): { baseUrl: string; contextWindow?: number } {
	const settings = new ProviderSettingsManager().getProviderSettings("ollama");
	return {
		baseUrl: settings?.baseUrl?.trim() ?? "",
		contextWindow: settings?.contextWindow,
	};
}

function createOllamaClient(): Ollama {
	const host =
		readOllamaSettings()
			.baseUrl.replace(/\/+$/, "")
			.replace(/\/(?:v1|api)$/, "") || DEFAULT_OLLAMA_BASE_URL;
	return new Ollama({ host });
}

function readModel(args: Record<string, unknown> | undefined): string {
	const model = typeof args?.model === "string" ? args.model.trim() : "";
	if (!model) {
		throw new Error("model is required");
	}
	return model;
}

async function getLocalModelsStatus(): Promise<LocalModelsStatus> {
	hardwarePromise ??= detectHardware();
	const hardware = await hardwarePromise;
	const { baseUrl, contextWindow } = readOllamaSettings();
	const base = {
		hardware,
		baseUrl,
		contextWindow,
		activePulls: [...activePulls.values()].map((pull) => pull.progress),
	};
	const client = createOllamaClient();
	try {
		const [{ version }, list, ps] = await Promise.all([
			client.version(),
			client.list(),
			client.ps(),
		]);
		return {
			...base,
			ollamaReachable: true,
			ollamaVersion: version,
			installed: list.models.map((model) => ({
				name: model.name,
				sizeBytes: model.size,
				parameterSize: model.details?.parameter_size ?? "",
				quantization: model.details?.quantization_level ?? "",
			})),
			running: ps.models.map((model) => ({
				name: model.name,
				sizeBytes: model.size,
				sizeVramBytes: model.size_vram,
				expiresAtMs: model.expires_at
					? new Date(model.expires_at).getTime()
					: 0,
				// Reported by Ollama 0.7+, but not yet in the SDK's types.
				contextLength:
					(model as { context_length?: number }).context_length ?? 0,
			})),
		};
	} catch {
		return { ...base, ollamaReachable: false, installed: [], running: [] };
	}
}

function startOllamaPull(
	ctx: SidecarContext,
	model: string,
): OllamaPullProgress {
	const existing = activePulls.get(model);
	if (existing) {
		return existing.progress;
	}

	let aborted = false;
	let abortStream: (() => void) | undefined;
	const pull = {
		progress: { model, status: "starting", completed: 0, total: 0 },
		abort: () => {
			aborted = true;
			abortStream?.();
		},
	};
	activePulls.set(model, pull);

	void (async () => {
		let final: OllamaPullProgress = {
			model,
			status: "success",
			completed: 0,
			total: 0,
			done: true,
		};
		try {
			const stream = await createOllamaClient().pull({ model, stream: true });
			abortStream = () => stream.abort();
			if (aborted) {
				stream.abort();
			}
			let lastNotifiedAt = 0;
			for await (const part of stream) {
				const statusChanged = part.status !== pull.progress.status;
				pull.progress = {
					model,
					status: part.status,
					// Layer-less status lines ("pulling manifest") carry no byte counts; keep the last ones.
					completed:
						part.completed ?? (statusChanged ? 0 : pull.progress.completed),
					total: part.total ?? (statusChanged ? 0 : pull.progress.total),
				};
				const now = Date.now();
				if (statusChanged || now - lastNotifiedAt >= PROGRESS_THROTTLE_MS) {
					lastNotifiedAt = now;
					broadcastEvent(ctx, OLLAMA_PULL_PROGRESS_EVENT, pull.progress);
				}
			}
		} catch (error) {
			final = {
				...final,
				status: "error",
				error: aborted
					? undefined
					: error instanceof Error
						? error.message
						: String(error),
			};
		} finally {
			activePulls.delete(model);
			broadcastEvent(ctx, OLLAMA_PULL_PROGRESS_EVENT, final);
		}
	})();

	return pull.progress;
}

export async function handleLocalModelsCommand(
	ctx: SidecarContext,
	command: string,
	args: Record<string, unknown> | undefined,
): Promise<unknown> {
	switch (command) {
		case "get_local_models_status":
			return await getLocalModelsStatus();
		case "pull_ollama_model":
			return startOllamaPull(ctx, readModel(args));
		case "cancel_ollama_pull":
			activePulls.get(readModel(args))?.abort();
			return {};
		case "load_ollama_model": {
			// num_ctx must match what Cline sends with each request, otherwise
			// Ollama reloads the model on the first message.
			const contextWindow =
				typeof args?.contextWindow === "number" ? args.contextWindow : 0;
			await createOllamaClient().generate({
				model: readModel(args),
				prompt: "",
				// Stay loaded until explicitly unloaded; requests without a keep_alive don't shorten it.
				keep_alive: -1,
				...(contextWindow > 0 ? { options: { num_ctx: contextWindow } } : {}),
			});
			return {};
		}
		case "unload_ollama_model":
			await createOllamaClient().generate({
				model: readModel(args),
				prompt: "",
				keep_alive: 0,
			});
			return {};
		case "delete_ollama_model":
			await createOllamaClient().delete({ model: readModel(args) });
			return {};
		default:
			throw new Error(`Unsupported local models command: ${command}`);
	}
}
