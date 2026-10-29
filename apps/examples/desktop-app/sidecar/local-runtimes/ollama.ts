import os from "node:os";
import path from "node:path";
import { Ollama } from "ollama";
import {
	LOCAL_RUNTIMES,
	parseOllamaParameters,
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

const readHost = () =>
	toServerUrl(
		readProviderSettings("ollama").baseUrl,
		LOCAL_RUNTIMES.ollama.defaultBaseUrl,
	);

const createClient = () =>
	new Ollama({ host: readHost(), headers: authHeaders("ollama") });

/**
 * Apps launched from the macOS Dock don't inherit the shell's PATH, so the
 * usual install locations are checked as well.
 */
async function findOllama(): Promise<
	{ kind: "mac-app" | "windows-app" | "cli"; path: string } | undefined
> {
	const home = os.homedir();
	if (process.platform === "darwin") {
		const app = await firstExecutable([
			"/Applications/Ollama.app",
			path.join(home, "Applications", "Ollama.app"),
		]);
		if (app) {
			return { kind: "mac-app", path: app };
		}
	}
	if (process.platform === "win32") {
		const app = await firstExecutable([
			path.join(
				process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"),
				"Programs",
				"Ollama",
				"ollama app.exe",
			),
		]);
		if (app) {
			return { kind: "windows-app", path: app };
		}
	}
	const binary = process.platform === "win32" ? "ollama.exe" : "ollama";
	const dirs = [
		...(process.env.PATH ?? "").split(path.delimiter),
		"/usr/local/bin",
		"/opt/homebrew/bin",
		"/usr/bin",
		path.join(home, ".local", "bin"),
	].filter(Boolean);
	const cli = await firstExecutable(dirs.map((dir) => path.join(dir, binary)));
	return cli ? { kind: "cli", path: cli } : undefined;
}

export const ollamaBackend: LocalRuntimeBackend = {
	readSettings: () => readProviderSettings("ollama"),

	isLocal: () => isLocalUrl(readHost()),

	isReachable: () =>
		respondsOk(`${readHost()}/api/version`, authHeaders("ollama")),

	isInstalled: async () => !!(await findOllama()),

	async start() {
		const install = await findOllama();
		if (!install) {
			throw new Error("Ollama isn't installed.");
		}
		// The desktop apps read their own settings, but `serve` takes the address from here.
		const serveEnv = { OLLAMA_HOST: new URL(readHost()).host };
		const spawnError =
			install.kind === "mac-app"
				? spawnDetached("open", ["-a", install.path])
				: install.kind === "windows-app"
					? spawnDetached(install.path, [])
					: spawnDetached(install.path, ["serve"], serveEnv);
		const reachable = await waitUntilReachable(
			ollamaBackend,
			20_000,
			spawnError,
		);
		if (
			!reachable &&
			install.kind !== "cli" &&
			new URL(readHost()).port !==
				new URL(LOCAL_RUNTIMES.ollama.defaultBaseUrl).port
		) {
			throw new Error(
				`The Ollama app didn't start on ${serveEnv.OLLAMA_HOST}. It uses its own address setting, so set OLLAMA_HOST for the app or run \`ollama serve\` yourself.`,
			);
		}
		return reachable;
	},

	async readModels() {
		const client = createClient();
		const [list, ps] = await Promise.all([client.list(), client.ps()]);
		return {
			installed: list.models.map((model) => {
				// Newer Ollama versions add these to `list`; the SDK doesn't type them yet.
				const extra = model as {
					capabilities?: string[];
					details?: { context_length?: number };
				};
				return {
					name: model.name,
					sizeBytes: model.size,
					parameterSize: model.details?.parameter_size ?? "",
					quantization: model.details?.quantization_level ?? "",
					capabilities: extra.capabilities ?? [],
					contextLength: extra.details?.context_length ?? 0,
					deletable: true,
				};
			}),
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
	},

	async modelDirs() {
		const home = os.homedir();
		// The Linux install script runs Ollama as its own user with models under /usr/share/ollama.
		return [
			process.env.OLLAMA_MODELS,
			path.join(home, ".ollama", "models"),
			"/usr/share/ollama/.ollama/models",
		].filter((dir): dir is string => !!dir);
	},

	async pull(model, onProgress, signal) {
		const stream = await createClient().pull({ model, stream: true });
		if (signal.aborted) {
			stream.abort();
		}
		signal.addEventListener("abort", () => stream.abort());
		let last = { status: "", completed: 0, total: 0 };
		for await (const part of stream) {
			const statusChanged = part.status !== last.status;
			last = {
				status: part.status,
				// Layer-less status lines ("pulling manifest") carry no byte counts; keep the last ones.
				completed: part.completed ?? (statusChanged ? 0 : last.completed),
				total: part.total ?? (statusChanged ? 0 : last.total),
			};
			onProgress(last);
		}
	},

	async load(model, contextWindow) {
		// num_ctx must match what Cline sends with each request, otherwise
		// Ollama reloads the model on the first message.
		await createClient().generate({
			model,
			prompt: "",
			// Stay loaded until explicitly unloaded; requests without a keep_alive don't shorten it.
			keep_alive: -1,
			...(contextWindow > 0 ? { options: { num_ctx: contextWindow } } : {}),
		});
	},

	async unload(model) {
		await createClient().generate({ model, prompt: "", keep_alive: 0 });
	},

	async delete(model) {
		await createClient().delete({ model });
	},

	async show(model) {
		const response = await createClient().show({ model });
		// Typed as a Map by the SDK, but it's a plain JSON object on the wire.
		const info = (response.model_info ?? {}) as unknown as Record<
			string,
			unknown
		>;
		const architecture = String(info["general.architecture"] ?? "");
		const numberInfo = (key: string) => {
			const value = info[`${architecture}.${key}`];
			return typeof value === "number" ? value : 0;
		};
		return {
			name: model,
			architecture: architecture || response.details?.family || "",
			parameterSize: response.details?.parameter_size ?? "",
			quantization: response.details?.quantization_level ?? "",
			format: response.details?.format ?? "",
			contextLength: numberInfo("context_length"),
			embeddingLength: numberInfo("embedding_length"),
			layers: numberInfo("block_count"),
			capabilities: response.capabilities ?? [],
			parameters: parseOllamaParameters(response.parameters ?? ""),
			template: response.template ?? "",
			system: response.system ?? "",
			license: response.license ?? "",
			modelfile: response.modelfile ?? "",
		};
	},
};
