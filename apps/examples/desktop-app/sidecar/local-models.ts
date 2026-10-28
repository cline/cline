import { execFile } from "node:child_process";
import { statfs } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";
import { clearPublicModelsCatalogCache } from "@cline/core";
import {
	isLocalRuntime,
	LOCAL_MODEL_PULL_PROGRESS_EVENT,
	LOCAL_RUNTIMES,
	type LocalHardwareInfo,
	type LocalModelPullProgress,
	type LocalModelsStatus,
	type LocalRuntime,
} from "../webview/lib/local-models";
import { broadcastEvent } from "./context";
import { lmstudioBackend } from "./local-runtimes/lmstudio";
import { ollamaBackend } from "./local-runtimes/ollama";
import type { LocalRuntimeBackend } from "./local-runtimes/shared";
import type { SidecarContext } from "./types";

const execFileAsync = promisify(execFile);
const BYTES_PER_GB = 1024 ** 3;
const PROGRESS_THROTTLE_MS = 250;

const BACKENDS: Record<LocalRuntime, LocalRuntimeBackend> = {
	ollama: ollamaBackend,
	lmstudio: lmstudioBackend,
};

export const LOCAL_MODELS_COMMANDS = new Set([
	"get_local_models_status",
	"pull_local_model",
	"cancel_local_model_pull",
	"load_local_model",
	"unload_local_model",
	"delete_local_model",
	"show_local_model",
	"start_local_runtime",
]);

let hardwarePromise: Promise<LocalHardwareInfo> | undefined;

// Downloads outlive the settings page that started them (an 18 GB pull takes a
// while), so they are tracked here and progress is broadcast to every window.
const activePulls = new Map<
	string,
	{ progress: LocalModelPullProgress; abort: AbortController }
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

async function readDiskSpace(
	backend: LocalRuntimeBackend,
): Promise<LocalModelsStatus["disk"]> {
	for (const dir of [...(await backend.modelDirs()), os.homedir()]) {
		try {
			const stats = await statfs(dir);
			return {
				freeBytes: stats.bavail * stats.bsize,
				totalBytes: stats.blocks * stats.bsize,
			};
		} catch {}
	}
	return undefined;
}

async function readRuntimeSummaries(): Promise<LocalModelsStatus["runtimes"]> {
	const entries = await Promise.all(
		(Object.keys(BACKENDS) as LocalRuntime[]).map(async (runtime) => {
			const reachable = await BACKENDS[runtime].isReachable();
			const installed = reachable || (await BACKENDS[runtime].isInstalled());
			return [runtime, { reachable, installed }] as const;
		}),
	);
	return Object.fromEntries(entries) as LocalModelsStatus["runtimes"];
}

/** Without a saved choice, prefer whichever runtime is running, then whichever is installed. */
function pickRuntime(runtimes: LocalModelsStatus["runtimes"]): LocalRuntime {
	const order: LocalRuntime[] = ["ollama", "lmstudio"];
	return (
		order.find((runtime) => runtimes[runtime].reachable) ??
		order.find((runtime) => runtimes[runtime].installed) ??
		"ollama"
	);
}

async function getLocalModelsStatus(
	requested: LocalRuntime | undefined,
): Promise<LocalModelsStatus> {
	hardwarePromise ??= detectHardware();
	const [hardware, runtimes] = await Promise.all([
		hardwarePromise,
		readRuntimeSummaries(),
	]);
	const runtime = requested ?? pickRuntime(runtimes);
	const backend = BACKENDS[runtime];
	const { baseUrl, contextWindow } = backend.readSettings();
	const local = backend.isLocal();
	const base = {
		runtime,
		hardware,
		runtimes,
		baseUrl,
		contextWindow,
		disk: local ? await readDiskSpace(backend) : undefined,
		activePulls: [...activePulls.values()]
			.map((pull) => pull.progress)
			.filter((progress) => progress.runtime === runtime),
	};
	if (runtimes[runtime].reachable) {
		try {
			return { ...base, reachable: true, ...(await backend.readModels()) };
		} catch {}
	}
	return {
		...base,
		reachable: false,
		install: { installed: runtimes[runtime].installed, localServer: local },
		installed: [],
		running: [],
	};
}

function startPull(
	ctx: SidecarContext,
	runtime: LocalRuntime,
	model: string,
): LocalModelPullProgress {
	const key = `${runtime}:${model}`;
	const existing = activePulls.get(key);
	if (existing) {
		return existing.progress;
	}

	const abort = new AbortController();
	const pull = {
		progress: {
			runtime,
			model,
			status: "starting",
			completed: 0,
			total: 0,
		} as LocalModelPullProgress,
		abort,
	};
	activePulls.set(key, pull);

	void (async () => {
		let final: LocalModelPullProgress = {
			...pull.progress,
			status: "success",
			done: true,
		};
		let lastNotifiedAt = 0;
		try {
			await BACKENDS[runtime].pull(
				model,
				(progress) => {
					const statusChanged = progress.status !== pull.progress.status;
					pull.progress = { runtime, model, ...progress };
					const now = Date.now();
					if (statusChanged || now - lastNotifiedAt >= PROGRESS_THROTTLE_MS) {
						lastNotifiedAt = now;
						broadcastEvent(ctx, LOCAL_MODEL_PULL_PROGRESS_EVENT, pull.progress);
					}
				},
				abort.signal,
			);
		} catch (error) {
			final = {
				...final,
				status: "error",
				error: abort.signal.aborted
					? undefined
					: error instanceof Error
						? error.message
						: String(error),
			};
		} finally {
			activePulls.delete(key);
			// The composer's model list comes from a cached copy of the runtime's.
			clearPublicModelsCatalogCache();
			broadcastEvent(ctx, LOCAL_MODEL_PULL_PROGRESS_EVENT, final);
		}
	})();

	return pull.progress;
}

function readRuntime(args: Record<string, unknown> | undefined): LocalRuntime {
	if (!isLocalRuntime(args?.runtime)) {
		throw new Error("runtime must be ollama or lmstudio");
	}
	return args.runtime;
}

function readModel(args: Record<string, unknown> | undefined): string {
	const model = typeof args?.model === "string" ? args.model.trim() : "";
	if (!model) {
		throw new Error("model is required");
	}
	return model;
}

export async function handleLocalModelsCommand(
	ctx: SidecarContext,
	command: string,
	args: Record<string, unknown> | undefined,
): Promise<unknown> {
	if (command === "get_local_models_status") {
		return await getLocalModelsStatus(
			isLocalRuntime(args?.runtime) ? args.runtime : undefined,
		);
	}
	const runtime = readRuntime(args);
	const backend = BACKENDS[runtime];
	switch (command) {
		case "pull_local_model":
			return startPull(ctx, runtime, readModel(args));
		case "cancel_local_model_pull":
			activePulls.get(`${runtime}:${readModel(args)}`)?.abort.abort();
			return {};
		case "load_local_model":
			await backend.load(
				readModel(args),
				typeof args?.contextWindow === "number" ? args.contextWindow : 0,
			);
			return {};
		case "unload_local_model":
			await backend.unload(readModel(args));
			return {};
		case "delete_local_model":
			await backend.delete(readModel(args));
			clearPublicModelsCatalogCache();
			return {};
		case "show_local_model":
			return await backend.show(readModel(args));
		case "start_local_runtime":
			if (!backend.isLocal()) {
				throw new Error(
					`Cline can only start ${LOCAL_RUNTIMES[runtime].name} on this computer.`,
				);
			}
			return { started: await backend.start() };
		default:
			throw new Error(`Unsupported local models command: ${command}`);
	}
}
