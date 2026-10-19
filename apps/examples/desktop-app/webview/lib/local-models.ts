/**
 * Curated Ollama models that work well with Cline, each with the context
 * window Cline should run it at. Ordered by how strongly we recommend them, so
 * the first one that fits a machine is its recommendation.
 *
 * `memoryGb` estimates weights plus KV cache at `contextWindow`; it is what
 * decides whether a model fits on the user's hardware.
 */
export interface LocalModelCatalogEntry {
	id: string;
	name: string;
	description: string;
	sizeGb: number;
	memoryGb: number;
	contextWindow: number;
	tags: string[];
}

export const LOCAL_MODEL_CATALOG: LocalModelCatalogEntry[] = [
	{
		id: "qwen3.8:27b",
		name: "Qwen3.8 27B",
		description:
			"The strongest all-round local model for agentic coding. Reliable tool use across long tasks.",
		sizeGb: 18,
		memoryGb: 23,
		contextWindow: 65536,
		tags: ["Best overall", "Vision"],
	},
	{
		id: "laguna-xs-2.1",
		name: "Laguna XS 2.1",
		description:
			"Mixture-of-experts model from Poolside built for long-horizon coding. Only 3B active parameters, so it's fast.",
		sizeGb: 20,
		memoryGb: 24,
		contextWindow: 65536,
		tags: ["Fast"],
	},
	{
		id: "qwen3.6:35b-a3b",
		name: "Qwen3.6 35B A3B",
		description:
			"Fast mixture-of-experts Qwen with solid agentic coding. A good pick when speed matters more than depth.",
		sizeGb: 24,
		memoryGb: 26,
		contextWindow: 65536,
		tags: ["Fast", "Vision"],
	},
	{
		id: "devstral-small-2:24b",
		name: "Devstral Small 2",
		description:
			"Mistral's agentic coding model, tuned for exploring codebases and editing many files.",
		sizeGb: 15,
		memoryGb: 21,
		contextWindow: 32768,
		tags: ["Vision"],
	},
	{
		id: "gpt-oss:20b",
		name: "gpt-oss 20B",
		description:
			"OpenAI's open-weight reasoning model. Light on memory and quick, a great fit for 16-24 GB machines.",
		sizeGb: 14,
		memoryGb: 16,
		contextWindow: 65536,
		tags: ["Fast"],
	},
	{
		id: "qwen3-coder-next",
		name: "Qwen3-Coder-Next",
		description:
			"80B mixture-of-experts coder with 3B active parameters, for machines with 64 GB or more.",
		sizeGb: 52,
		memoryGb: 56,
		contextWindow: 65536,
		tags: ["Fast"],
	},
	{
		id: "qwen3:8b",
		name: "Qwen3 8B",
		description:
			"Small enough for 8-16 GB machines. Handles simple edits, but struggles with larger multi-step tasks.",
		sizeGb: 5.2,
		memoryGb: 10,
		contextWindow: 32768,
		tags: ["Lightweight"],
	},
];

/** Context window for installed models that aren't in the catalog; matches the SDK's Ollama default. */
export const DEFAULT_LOCAL_CONTEXT_WINDOW = 32768;

export interface LocalHardwareInfo {
	platform: string;
	arch: string;
	cpuModel: string;
	cpuCores: number;
	totalMemoryGb: number;
	unifiedMemory: boolean;
	gpus: { name: string; memoryGb: number }[];
}

export interface OllamaPullProgress {
	model: string;
	status: string;
	completed: number;
	total: number;
	/** Set on the final event of a download. */
	done?: boolean;
	error?: string;
}

/** Payload of `get_local_models_status`. */
export interface LocalModelsStatus {
	hardware: LocalHardwareInfo;
	/** The Ollama provider's saved base URL and context window. */
	baseUrl: string;
	contextWindow?: number;
	ollamaReachable: boolean;
	ollamaVersion?: string;
	/** Only checked while Ollama is unreachable. */
	ollamaInstall?: {
		installed: boolean;
		/** The base URL points at this machine, so Cline can start Ollama itself. */
		localServer: boolean;
	};
	/** Space on the drive Ollama stores models on. Local servers only. */
	disk?: { freeBytes: number; totalBytes: number };
	installed: {
		name: string;
		sizeBytes: number;
		parameterSize: string;
		quantization: string;
		/** e.g. `tools`, `thinking`, `vision`. Reported by newer Ollama versions. */
		capabilities: string[];
		/** The longest context the model supports, or 0 if unknown. */
		contextLength: number;
	}[];
	running: {
		name: string;
		sizeBytes: number;
		sizeVramBytes: number;
		expiresAtMs: number;
		contextLength: number;
	}[];
	activePulls: OllamaPullProgress[];
}

/** Payload of `show_ollama_model`. */
export interface LocalModelDetails {
	name: string;
	architecture: string;
	parameterSize: string;
	quantization: string;
	format: string;
	contextLength: number;
	embeddingLength: number;
	layers: number;
	capabilities: string[];
	/** Defaults baked into the model, e.g. `{ temperature: ["0.6"], stop: ["<|im_end|>"] }`. */
	parameters: Record<string, string[]>;
	template: string;
	system: string;
	license: string;
	modelfile: string;
}

export const OLLAMA_PULL_PROGRESS_EVENT = "ollama_pull_progress";

export const formatGb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;

export const formatContext = (tokens: number) =>
	`${Math.round(tokens / 1024)}K context`;

/** Ollama reports models pinned with keep_alive -1 as expiring centuries from now. */
export function isPinnedLoaded(expiresAtMs: number): boolean {
	return expiresAtMs - Date.now() >= 365 * 24 * 60 * 60 * 1000;
}

export function describeModelPlacement(
	running: Pick<
		LocalModelsStatus["running"][number],
		"sizeBytes" | "sizeVramBytes"
	>,
): string {
	if (running.sizeVramBytes <= 0) {
		return "on CPU";
	}
	if (running.sizeVramBytes >= running.sizeBytes) {
		return "on GPU";
	}
	return `${Math.round((running.sizeVramBytes / running.sizeBytes) * 100)}% on GPU`;
}

export function describeUnloadTime(expiresAtMs: number): string | undefined {
	if (isPinnedLoaded(expiresAtMs)) {
		return "stays loaded until unloaded";
	}
	if (expiresAtMs <= 0) {
		return undefined;
	}
	const time = new Date(expiresAtMs).toLocaleTimeString([], {
		hour: "numeric",
		minute: "2-digit",
	});
	return `unloads at ${time} if idle`;
}

/**
 * - `great`: fits entirely in GPU (or Apple unified) memory
 * - `slow`: only fits by spilling onto the CPU
 * - `too-large`: doesn't fit in memory at all
 */
export type LocalModelFit = "great" | "slow" | "too-large";

type LocalHardware = Pick<
	LocalHardwareInfo,
	"totalMemoryGb" | "unifiedMemory" | "gpus"
>;

/** System RAM plus dedicated GPU memory, in bytes. */
export function getMachineMemoryBytes(hardware: LocalHardware): number {
	const gpuGb = hardware.unifiedMemory
		? 0
		: hardware.gpus.reduce((sum, gpu) => sum + gpu.memoryGb, 0);
	return (hardware.totalMemoryGb + gpuGb) * 1024 ** 3;
}

export function getLocalMemoryBudget(hardware: LocalHardware): {
	gpuGb: number;
	totalGb: number;
} {
	if (hardware.unifiedMemory) {
		// macOS lets the GPU use roughly three quarters of unified memory.
		return {
			gpuGb: hardware.totalMemoryGb * 0.75,
			totalGb: hardware.totalMemoryGb * 0.85,
		};
	}
	const gpuGb = hardware.gpus.reduce((sum, gpu) => sum + gpu.memoryGb, 0);
	return { gpuGb, totalGb: gpuGb + hardware.totalMemoryGb * 0.7 };
}

export function evaluateLocalModelFit(
	memoryGb: number,
	hardware: LocalHardware,
): LocalModelFit {
	const { gpuGb, totalGb } = getLocalMemoryBudget(hardware);
	if (memoryGb <= gpuGb) {
		return "great";
	}
	return memoryGb <= totalGb ? "slow" : "too-large";
}

export function getRecommendedLocalModel(
	hardware: LocalHardware,
): LocalModelCatalogEntry | undefined {
	const great = LOCAL_MODEL_CATALOG.find(
		(entry) => evaluateLocalModelFit(entry.memoryGb, hardware) === "great",
	);
	if (great) {
		return great;
	}
	// Mixture-of-experts models only compute a few billion parameters per token, so they hold up far better on CPU.
	const slow = LOCAL_MODEL_CATALOG.filter(
		(entry) => evaluateLocalModelFit(entry.memoryGb, hardware) === "slow",
	);
	return slow.find((entry) => entry.tags.includes("Fast")) ?? slow[0];
}

/**
 * Parse `ollama show`'s `parameters` text, one `name value` pair per line.
 * Names like `stop` can repeat.
 */
export function parseOllamaParameters(text: string): Record<string, string[]> {
	const parameters: Record<string, string[]> = {};
	for (const line of text.split("\n")) {
		const match = line.trim().match(/^(\S+)\s+(.+)$/);
		if (!match) {
			continue;
		}
		const [, name, raw] = match;
		const value = raw.trim().replace(/^"(.*)"$/, "$1");
		parameters[name] = [...(parameters[name] ?? []), value];
	}
	return parameters;
}

/** Ollama treats an untagged name as `:latest`. */
export function normalizeOllamaModelName(name: string): string {
	return name.includes(":") ? name : `${name}:latest`;
}
