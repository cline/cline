import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
	LOCAL_RUNTIMES,
	type LocalModelDetails,
} from "../../webview/lib/local-models";
import {
	authHeaders,
	firstExecutable,
	isLocalUrl,
	type LocalRuntimeBackend,
	readProviderSettings,
	respondsOk,
	spawnDetached,
	toServerUrl,
	waitUntilReachable,
} from "./shared";

const execFileAsync = promisify(execFile);

/** A model from LM Studio's `GET /api/v1/models`. */
interface LmStudioModel {
	type: string;
	key: string;
	display_name?: string;
	architecture?: string;
	quantization?: { name?: string } | null;
	size_bytes: number;
	params_string?: string | null;
	max_context_length?: number;
	format?: string;
	capabilities?: {
		vision?: boolean;
		trained_for_tool_use?: boolean;
		reasoning?: unknown;
	};
	loaded_instances?: { id: string; config?: Record<string, unknown> }[];
	variants?: string[];
}

/** A job from `POST /api/v1/models/download` and its status endpoint. */
interface LmStudioDownloadJob {
	job_id?: string;
	status: string;
	downloaded_bytes?: number;
	total_size_bytes?: number;
}

const readServerUrl = () =>
	toServerUrl(
		readProviderSettings("lmstudio").baseUrl,
		LOCAL_RUNTIMES.lmstudio.defaultBaseUrl,
	);

async function request<T>(pathname: string, body?: unknown): Promise<T> {
	const response = await fetch(`${readServerUrl()}${pathname}`, {
		method: body === undefined ? "GET" : "POST",
		headers: { "content-type": "application/json", ...authHeaders("lmstudio") },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const payload = (await response.json().catch(() => ({}))) as {
		error?: string | { message?: string };
	};
	if (!response.ok) {
		const error = payload.error;
		throw new Error(
			(typeof error === "string" ? error : error?.message) ??
				`LM Studio responded with ${response.status}`,
		);
	}
	return payload as T;
}

async function listModels(): Promise<LmStudioModel[]> {
	const { models } = await request<{ models: LmStudioModel[] }>(
		"/api/v1/models",
	);
	return models.filter((model) => model.type === "llm");
}

async function findModel(key: string): Promise<LmStudioModel> {
	const model = (await listModels()).find((entry) => entry.key === key);
	if (!model) {
		throw new Error(`LM Studio doesn't have ${key}.`);
	}
	return model;
}

const readCapabilities = (model: LmStudioModel) =>
	[
		model.capabilities?.trained_for_tool_use ? "tools" : "",
		model.capabilities?.reasoning ? "thinking" : "",
		model.capabilities?.vision ? "vision" : "",
	].filter(Boolean);

/** LM Studio keeps its data in ~/.lmstudio unless moved, in which case a pointer file says where. */
async function readHome(): Promise<string> {
	try {
		const pointer = await readFile(
			path.join(os.homedir(), ".lmstudio-home-pointer"),
			"utf8",
		);
		if (pointer.trim()) {
			return pointer.trim();
		}
	} catch {}
	return path.join(os.homedir(), ".lmstudio");
}

async function readModelsDir(home: string): Promise<string> {
	try {
		const settings = JSON.parse(
			await readFile(path.join(home, "settings.json"), "utf8"),
		) as { downloadsFolder?: unknown };
		if (
			typeof settings.downloadsFolder === "string" &&
			settings.downloadsFolder
		) {
			return settings.downloadsFolder;
		}
	} catch {}
	return path.join(home, "models");
}

/** Whether `dir` is exactly `depth` folders inside `parent`, e.g. `<models>/<publisher>/<repo>`. */
export function isNestedDir(parent: string, dir: string, depth: number) {
	const relative = path.relative(parent, dir);
	const parts = relative.split(path.sep);
	return (
		!path.isAbsolute(relative) &&
		parts.length === depth &&
		parts.every((part) => part !== "" && part !== "." && part !== "..")
	);
}

const hubModelsDir = (home: string) => path.join(home, "hub", "models");

/**
 * Deleting removes the model's whole source repos, which also hold any other
 * downloaded variants, and only makes sense when those files are on this computer.
 */
const canDelete = (model: LmStudioModel) =>
	isLocalUrl(readServerUrl()) && (model.variants?.length ?? 0) <= 1;

/**
 * Models downloaded from LM Studio Hub come with a manifest naming the
 * Hugging Face repos their files were downloaded from. LM Studio has no API
 * for deleting models, so this is how Cline finds the files to remove.
 */
async function readHubSources(
	home: string,
	key: string,
): Promise<{ user: string; repo: string }[] | undefined> {
	try {
		const manifest = JSON.parse(
			await readFile(
				path.join(hubModelsDir(home), key, "manifest.json"),
				"utf8",
			),
		) as {
			dependencies?: {
				sources?: { type?: string; user?: string; repo?: string }[];
			}[];
		};
		return (manifest.dependencies ?? [])
			.flatMap((dependency) => dependency.sources ?? [])
			.filter(
				(source): source is { user: string; repo: string } =>
					source.type === "huggingface" && !!source.user && !!source.repo,
			);
	} catch {
		return undefined;
	}
}

/** The `lms` CLI, which both the LM Studio app and the headless llmster install into the LM Studio home. */
async function findLms(home: string): Promise<string | undefined> {
	const binary = process.platform === "win32" ? "lms.exe" : "lms";
	return await firstExecutable(
		[path.join(home, "bin"), ...(process.env.PATH ?? "").split(path.delimiter)]
			.filter(Boolean)
			.map((dir) => path.join(dir, binary)),
	);
}

async function findApp(): Promise<string | undefined> {
	const home = os.homedir();
	if (process.platform === "darwin") {
		return await firstExecutable([
			"/Applications/LM Studio.app",
			path.join(home, "Applications", "LM Studio.app"),
		]);
	}
	if (process.platform === "win32") {
		return await firstExecutable([
			path.join(
				process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"),
				"Programs",
				"LM Studio",
				"LM Studio.exe",
			),
		]);
	}
	return undefined;
}

export const lmstudioBackend: LocalRuntimeBackend = {
	readSettings: () => readProviderSettings("lmstudio"),

	isLocal: () => isLocalUrl(readServerUrl()),

	isReachable: () =>
		respondsOk(`${readServerUrl()}/api/v1/models`, authHeaders("lmstudio")),

	async isInstalled() {
		return !!((await findLms(await readHome())) ?? (await findApp()));
	},

	async start() {
		const lms = await findLms(await readHome());
		if (lms) {
			const { port } = new URL(readServerUrl());
			// Wakes the LM Studio service if it isn't running, then starts its server.
			await execFileAsync(
				lms,
				["server", "start", ...(port ? ["--port", port] : [])],
				{ timeout: 60_000, windowsHide: true },
			);
			return await waitUntilReachable(lmstudioBackend, 10_000);
		}
		const app = await findApp();
		if (!app) {
			throw new Error("LM Studio isn't installed.");
		}
		const spawnError =
			process.platform === "darwin"
				? spawnDetached("open", ["-a", app])
				: spawnDetached(app, []);
		return await waitUntilReachable(lmstudioBackend, 30_000, spawnError);
	},

	async readModels() {
		const [models, home] = await Promise.all([listModels(), readHome()]);
		return {
			installed: await Promise.all(
				models.map(async (model) => ({
					name: model.key,
					displayName: model.display_name,
					sizeBytes: model.size_bytes,
					parameterSize: model.params_string ?? "",
					quantization: model.quantization?.name ?? "",
					capabilities: readCapabilities(model),
					contextLength: model.max_context_length ?? 0,
					deletable:
						canDelete(model) && !!(await readHubSources(home, model.key)),
				})),
			),
			running: models
				.filter((model) => model.loaded_instances?.length)
				.map((model) => ({
					name: model.key,
					sizeBytes: model.size_bytes * (model.loaded_instances?.length ?? 1),
					contextLength:
						Number(model.loaded_instances?.[0]?.config?.context_length) || 0,
				})),
		};
	},

	async modelDirs() {
		return [await readModelsDir(await readHome())];
	},

	async pull(model, onProgress) {
		let job = await request<LmStudioDownloadJob>("/api/v1/models/download", {
			model,
		});
		while (job.status !== "completed" && job.status !== "already_downloaded") {
			if (job.status === "failed" || !job.job_id) {
				throw new Error(`LM Studio couldn't download ${model}.`);
			}
			if (job.status === "paused") {
				throw new Error(
					`The download of ${model} was paused. Resume it in LM Studio.`,
				);
			}
			onProgress({
				status: job.status,
				completed: job.downloaded_bytes ?? 0,
				total: job.total_size_bytes ?? 0,
			});
			await new Promise((resolve) => setTimeout(resolve, 500));
			job = await request<LmStudioDownloadJob>(
				`/api/v1/models/download/status/${job.job_id}`,
			);
		}
	},

	async load(model, contextWindow) {
		const info = await findModel(model);
		const contextLength = info.max_context_length
			? Math.min(contextWindow, info.max_context_length)
			: contextWindow;
		const instances = info.loaded_instances ?? [];
		if (
			instances.some(
				(instance) => Number(instance.config?.context_length) === contextLength,
			)
		) {
			return;
		}
		// Loading again would add a second copy rather than resize the first.
		for (const instance of instances) {
			await request("/api/v1/models/unload", { instance_id: instance.id });
		}
		await request("/api/v1/models/load", {
			model,
			...(contextLength > 0 ? { context_length: contextLength } : {}),
		});
	},

	async unload(model) {
		for (const instance of (await findModel(model)).loaded_instances ?? []) {
			await request("/api/v1/models/unload", { instance_id: instance.id });
		}
	},

	async delete(model) {
		if (!canDelete(await findModel(model))) {
			throw new Error(
				"Cline can't delete this model. Remove it from LM Studio.",
			);
		}
		const home = await readHome();
		const sources = await readHubSources(home, model);
		if (!sources) {
			throw new Error(
				"Cline can only delete models downloaded from LM Studio Hub. Remove this one from LM Studio.",
			);
		}
		const modelsDir = await readModelsDir(home);
		const hubDir = path.join(hubModelsDir(home), model);
		const sourceDirs = sources.map((source) =>
			path.join(modelsDir, source.user, source.repo),
		);
		if (
			!isNestedDir(hubModelsDir(home), hubDir, 2) ||
			!sourceDirs.every((dir) => isNestedDir(modelsDir, dir, 2))
		) {
			throw new Error(`Refusing to delete files outside ${modelsDir}.`);
		}
		await lmstudioBackend.unload(model);
		for (const dir of [...sourceDirs, hubDir]) {
			await rm(dir, { recursive: true, force: true });
		}
	},

	async show(model): Promise<LocalModelDetails> {
		const info = await findModel(model);
		const config = info.loaded_instances?.[0]?.config;
		return {
			name: model,
			architecture: info.architecture ?? "",
			parameterSize: info.params_string ?? "",
			quantization: info.quantization?.name ?? "",
			format: info.format ?? "",
			contextLength: info.max_context_length ?? 0,
			embeddingLength: 0,
			layers: 0,
			capabilities: readCapabilities(info),
			parameters: {},
			template: "",
			system: "",
			license: "",
			modelfile: "",
			loadConfig: config
				? Object.fromEntries(
						Object.entries(config).filter(
							(entry): entry is [string, string | number | boolean] =>
								["string", "number", "boolean"].includes(typeof entry[1]),
						),
					)
				: undefined,
		};
	},
};
