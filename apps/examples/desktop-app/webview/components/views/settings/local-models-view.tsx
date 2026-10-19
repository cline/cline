"use client";

import {
	Download,
	Loader2,
	Play,
	RefreshCw,
	Square,
	Trash2,
	X,
} from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";
import {
	DEFAULT_LOCAL_CONTEXT_WINDOW,
	evaluateLocalModelFit,
	getLocalMemoryBudget,
	getRecommendedLocalModel,
	LOCAL_MODEL_CATALOG,
	type LocalHardwareInfo,
	type LocalModelCatalogEntry,
	type LocalModelFit,
	type LocalModelsStatus,
	normalizeOllamaModelName,
	OLLAMA_PULL_PROGRESS_EVENT,
	type OllamaPullProgress,
} from "@/lib/local-models";
import {
	readModelSelectionStorageFromWindow,
	selectChatModel,
} from "@/lib/model-selection";
import {
	loadProviderModels,
	publishProviderModels,
} from "@/lib/provider-model-catalog";
import { cn } from "@/lib/utils";
import { PageFrame, PageHeader } from "../page-layout";

type ModelAction = "using" | "loading" | "unloading" | "deleting";

const FIT_LABELS: Record<LocalModelFit, { text: string; className: string }> = {
	great: {
		text: "Runs well on this machine",
		className: "text-emerald-600 dark:text-emerald-400",
	},
	slow: {
		text: "Will run slowly on this machine",
		className: "text-amber-700 dark:text-amber-300",
	},
	"too-large": {
		text: "Too large for this machine",
		className: "text-destructive",
	},
};

const formatGb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;
const formatContext = (tokens: number) =>
	`${Math.round(tokens / 1024)}K context`;

function readActiveOllamaModel(): string | undefined {
	const selection = readModelSelectionStorageFromWindow();
	const model = selection.lastModelByProvider.ollama;
	return selection.lastProvider === "ollama" && model
		? normalizeOllamaModelName(model)
		: undefined;
}

function describeHardware(hardware: LocalHardwareInfo): string {
	const memory = `${Math.round(hardware.totalMemoryGb)} GB`;
	if (hardware.unifiedMemory) {
		return `${hardware.cpuModel} · ${memory} unified memory`;
	}
	if (hardware.gpus.length > 0) {
		const gpus = hardware.gpus
			.map((gpu) => `${gpu.name} (${Math.round(gpu.memoryGb)} GB)`)
			.join(", ");
		return `${gpus} · ${memory} RAM`;
	}
	return `${hardware.cpuModel} · ${memory} RAM · No supported GPU detected`;
}

function describeRunning(running: LocalModelsStatus["running"][number]) {
	const placement =
		running.sizeVramBytes <= 0
			? "on CPU"
			: running.sizeVramBytes >= running.sizeBytes
				? "on GPU"
				: `${Math.round((running.sizeVramBytes / running.sizeBytes) * 100)}% on GPU`;
	const parts = [`Loaded ${placement}`, formatGb(running.sizeBytes)];
	if (running.contextLength > 0) {
		parts.push(formatContext(running.contextLength));
	}
	// Ollama reports models pinned with keep_alive -1 as expiring centuries from now.
	const oneYearMs = 365 * 24 * 60 * 60 * 1000;
	if (running.expiresAtMs - Date.now() >= oneYearMs) {
		parts.push("stays loaded until unloaded");
	} else if (running.expiresAtMs > 0) {
		const time = new Date(running.expiresAtMs).toLocaleTimeString([], {
			hour: "numeric",
			minute: "2-digit",
		});
		parts.push(`unloads at ${time} if idle`);
	}
	return parts.join(" · ");
}

export function LocalModelsContent() {
	const [status, setStatus] = useState<LocalModelsStatus>();
	const [refreshing, setRefreshing] = useState(false);
	const [pulls, setPulls] = useState<Record<string, OllamaPullProgress>>({});
	const [actions, setActions] = useState<Record<string, ModelAction>>({});
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [activeModel, setActiveModel] = useState(readActiveOllamaModel);

	const setModelError = useCallback(
		(model: string, message: string | undefined) => {
			setErrors(({ [model]: _, ...rest }) =>
				message ? { ...rest, [model]: message } : rest,
			);
		},
		[],
	);

	const refresh = useCallback(async () => {
		setRefreshing(true);
		try {
			const next = await desktopClient.invoke<LocalModelsStatus>(
				"get_local_models_status",
			);
			setStatus(next);
			// Downloads keep running in the backend while this page is closed.
			setPulls((prev) =>
				Object.fromEntries(
					next.activePulls.map((pull) => [
						pull.model,
						prev[pull.model] ?? pull,
					]),
				),
			);
		} catch (error) {
			console.error("Failed to read local models status:", error);
		} finally {
			setRefreshing(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useEffect(
		() =>
			desktopClient.subscribe(OLLAMA_PULL_PROGRESS_EVENT, (payload) => {
				const progress = payload as OllamaPullProgress;
				if (!progress.done) {
					setPulls((prev) => ({ ...prev, [progress.model]: progress }));
					return;
				}
				setPulls(({ [progress.model]: _, ...rest }) => rest);
				setModelError(progress.model, progress.error);
				void refresh();
			}),
		[refresh, setModelError],
	);

	// Loaded models can be unloaded by Ollama's idle timeout or from outside Cline.
	useEffect(() => {
		const onFocus = () => void refresh();
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [refresh]);
	const nextExpiryMs = useMemo(() => {
		const expiries = (status?.running ?? [])
			.map((model) => model.expiresAtMs)
			.filter((ms) => ms > Date.now());
		return expiries.length > 0 ? Math.min(...expiries) : undefined;
	}, [status]);
	useEffect(() => {
		if (!nextExpiryMs || nextExpiryMs - Date.now() > 60 * 60 * 1000) {
			return;
		}
		const timer = window.setTimeout(
			() => void refresh(),
			nextExpiryMs - Date.now() + 1000,
		);
		return () => window.clearTimeout(timer);
	}, [nextExpiryMs, refresh]);

	const runAction = useCallback(
		async (model: string, action: ModelAction, run: () => Promise<unknown>) => {
			setActions((prev) => ({ ...prev, [model]: action }));
			setModelError(model, undefined);
			try {
				await run();
			} catch (error) {
				setModelError(
					model,
					error instanceof Error ? error.message : String(error),
				);
			} finally {
				setActions(({ [model]: _, ...rest }) => rest);
				void refresh();
			}
		},
		[refresh, setModelError],
	);

	const startPull = useCallback(
		async (model: string) => {
			setModelError(model, undefined);
			try {
				const progress = await desktopClient.invoke<OllamaPullProgress>(
					"pull_ollama_model",
					{ model },
				);
				setPulls((prev) => ({ ...prev, [model]: prev[model] ?? progress }));
			} catch (error) {
				setModelError(
					model,
					error instanceof Error ? error.message : String(error),
				);
			}
		},
		[setModelError],
	);

	const contextWindowFor = (model: string) => {
		if (model === activeModel && status?.contextWindow) {
			return status.contextWindow;
		}
		return (
			LOCAL_MODEL_CATALOG.find(
				(entry) => normalizeOllamaModelName(entry.id) === model,
			)?.contextWindow ?? DEFAULT_LOCAL_CONTEXT_WINDOW
		);
	};

	const loadModel = (model: string, contextWindow: number) =>
		// Loading a large model can take minutes.
		desktopClient.invoke(
			"load_ollama_model",
			{ model, contextWindow },
			{ timeoutMs: null },
		);

	const switchToModel = (model: string, contextWindow: number) =>
		runAction(model, "using", async () => {
			await desktopClient.invoke("save_provider_settings", {
				provider: "ollama",
				settings: { model, contextWindow },
			});
			// The composer only offers providers whose models it knows about.
			publishProviderModels("ollama", await loadProviderModels("ollama"));
			selectChatModel("ollama", model);
			setActiveModel(model);
			// Warm the model up so the first message doesn't wait on a cold load.
			await loadModel(model, contextWindow);
		});

	const installed = useMemo(
		() =>
			new Map(
				(status?.installed ?? []).map((model) => [
					normalizeOllamaModelName(model.name),
					model,
				]),
			),
		[status],
	);
	const running = useMemo(
		() =>
			new Map(
				(status?.running ?? []).map((model) => [
					normalizeOllamaModelName(model.name),
					model,
				]),
			),
		[status],
	);
	const hardware = status?.hardware;
	const recommended = hardware ? getRecommendedLocalModel(hardware) : undefined;
	const catalogIds = new Set(
		LOCAL_MODEL_CATALOG.map((entry) => normalizeOllamaModelName(entry.id)),
	);
	const otherInstalled = [...installed.entries()].filter(
		([name]) => !catalogIds.has(name),
	);
	const reachable = status?.ollamaReachable ?? false;

	const renderModelRow = (
		model: string,
		{
			title,
			entry,
			details,
		}: { title: string; entry?: LocalModelCatalogEntry; details: ReactNode },
	) => {
		const name = normalizeOllamaModelName(model);
		const isInstalled = installed.has(name);
		const runningModel = running.get(name);
		const pull = pulls[model];
		const action = actions[name];
		const error = errors[model] ?? errors[name];
		const isActive = name === activeModel;
		const fit =
			entry && hardware
				? evaluateLocalModelFit(entry.memoryGb, hardware)
				: undefined;
		const pullPercent =
			pull && pull.total > 0 ? (pull.completed / pull.total) * 100 : 0;

		return (
			<div
				className="flex flex-col gap-2 border-b px-4 py-4 last:border-b-0"
				key={model}
			>
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-sm font-semibold text-foreground">{title}</span>
					{entry && entry === recommended ? (
						<Badge>Recommended for you</Badge>
					) : null}
					{isActive ? (
						<Badge
							className="border-emerald-400/50 text-emerald-600 dark:text-emerald-400"
							variant="outline"
						>
							In use
						</Badge>
					) : null}
					{entry?.tags.map((tag) => (
						<Badge key={tag} variant="muted">
							{tag}
						</Badge>
					))}
				</div>
				{entry ? (
					<p className="text-sm text-muted-foreground">{entry.description}</p>
				) : null}
				<p className="text-xs text-muted-foreground">
					{details}
					{fit ? (
						<span className={FIT_LABELS[fit].className}>
							{" "}
							· {FIT_LABELS[fit].text}
						</span>
					) : null}
				</p>
				{runningModel ? (
					<p className="flex items-center gap-1.5 text-xs text-foreground">
						<span className="inline-block size-2 rounded-full bg-emerald-500" />
						{describeRunning(runningModel)}
					</p>
				) : null}
				{pull ? (
					<div className="flex max-w-md flex-col gap-1">
						<Progress className="h-1.5" value={pullPercent} />
						<div className="flex justify-between gap-2 text-xs text-muted-foreground">
							<span className="truncate">
								{pull.status.startsWith("pulling") && pull.total > 0
									? `Downloading ${formatGb(pull.completed)} of ${formatGb(pull.total)}`
									: pull.status}
							</span>
							{pull.total > 0 ? <span>{Math.floor(pullPercent)}%</span> : null}
						</div>
					</div>
				) : null}
				{error ? (
					<p className="break-words text-xs text-destructive" role="alert">
						{error}
					</p>
				) : null}
				<div className="mt-1 flex flex-wrap gap-2">
					{!isInstalled && !pull ? (
						<Button
							disabled={!reachable}
							onClick={() => void startPull(model)}
							size="sm"
							type="button"
							variant={fit === "too-large" ? "outline" : "default"}
						>
							<Download />
							Download{entry ? ` (${entry.sizeGb} GB)` : ""}
						</Button>
					) : null}
					{pull ? (
						<Button
							onClick={() =>
								void desktopClient.invoke("cancel_ollama_pull", { model })
							}
							size="sm"
							type="button"
							variant="outline"
						>
							<X />
							Cancel
						</Button>
					) : null}
					{isInstalled && !isActive ? (
						<Button
							disabled={!!action}
							onClick={() =>
								void switchToModel(
									name,
									entry?.contextWindow ?? DEFAULT_LOCAL_CONTEXT_WINDOW,
								)
							}
							size="sm"
							type="button"
						>
							{action === "using" ? <Loader2 className="animate-spin" /> : null}
							Use with Cline
						</Button>
					) : null}
					{isInstalled && !runningModel ? (
						<Button
							disabled={!!action}
							onClick={() =>
								void runAction(name, "loading", () =>
									loadModel(name, contextWindowFor(name)),
								)
							}
							size="sm"
							type="button"
							variant="outline"
						>
							{action === "loading" ? (
								<Loader2 className="animate-spin" />
							) : (
								<Play />
							)}
							{action === "loading" ? "Loading…" : "Load"}
						</Button>
					) : null}
					{runningModel ? (
						<Button
							disabled={!!action}
							onClick={() =>
								void runAction(name, "unloading", () =>
									desktopClient.invoke("unload_ollama_model", { model: name }),
								)
							}
							size="sm"
							type="button"
							variant="outline"
						>
							{action === "unloading" ? (
								<Loader2 className="animate-spin" />
							) : (
								<Square />
							)}
							Unload
						</Button>
					) : null}
					{isInstalled ? (
						<Button
							aria-label={`Delete ${title}`}
							disabled={!!action}
							onClick={() =>
								void runAction(name, "deleting", () =>
									desktopClient.invoke("delete_ollama_model", { model: name }),
								)
							}
							size="sm"
							title="Delete from disk"
							type="button"
							variant="ghost"
						>
							{action === "deleting" ? (
								<Loader2 className="animate-spin" />
							) : (
								<Trash2 />
							)}
						</Button>
					) : null}
				</div>
			</div>
		);
	};

	const budget = hardware ? getLocalMemoryBudget(hardware) : undefined;

	return (
		<PageFrame>
			<PageHeader
				description={
					<>
						Run models on your own machine with Ollama. Download one, then click{" "}
						<span className="font-medium text-foreground">Use with Cline</span>{" "}
						to switch Cline to it with the right settings.
					</>
				}
				title="Local Models"
			/>
			<section className="flex max-w-3xl flex-col gap-6">
				{hardware ? (
					<div className="flex flex-col gap-1 rounded-lg border bg-card px-4 py-3">
						<span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Your machine
						</span>
						<span className="text-sm text-foreground">
							{describeHardware(hardware)}
						</span>
						{budget ? (
							<span className="text-xs text-muted-foreground">
								{budget.gpuGb > 0
									? `Models needing up to ~${Math.floor(budget.gpuGb)} GB run fully on the GPU.`
									: "Without a supported GPU, models run on the CPU and respond slowly."}
							</span>
						) : null}
					</div>
				) : null}

				<div className="flex flex-col gap-2">
					<div className="flex items-center gap-2 text-sm">
						<span
							className={cn(
								"inline-block size-2 rounded-full",
								!status
									? "bg-muted-foreground/40"
									: reachable
										? "bg-emerald-500"
										: "bg-destructive",
							)}
						/>
						<span className="flex-1 text-foreground">
							{!status
								? "Checking for Ollama…"
								: reachable
									? `Ollama ${status.ollamaVersion} is running`
									: "Ollama isn't running"}
						</span>
						<Button
							aria-label="Refresh"
							disabled={refreshing}
							onClick={() => void refresh()}
							size="icon"
							type="button"
							variant="ghost"
						>
							<RefreshCw className={refreshing ? "animate-spin" : ""} />
						</Button>
					</div>
					{status && !reachable ? (
						<p className="text-sm text-muted-foreground">
							<button
								className="text-primary underline-offset-4 hover:underline"
								onClick={() =>
									void openExternalUrl("https://ollama.com/download")
								}
								type="button"
							>
								Install Ollama
							</button>{" "}
							and start it (or run <code>ollama serve</code>). Cline looks for
							it at {status.baseUrl || "http://localhost:11434"}, which you can
							change under Providers → Ollama.
						</p>
					) : null}
				</div>

				<div>
					<p className="mb-2 text-sm font-semibold text-foreground">
						Recommended models
					</p>
					<div className="overflow-hidden rounded-lg border">
						{LOCAL_MODEL_CATALOG.map((entry) =>
							renderModelRow(entry.id, {
								title: entry.name,
								entry,
								details: `${entry.id} · ${entry.sizeGb} GB download · needs ~${entry.memoryGb} GB memory · ${formatContext(entry.contextWindow)}`,
							}),
						)}
					</div>
				</div>

				{otherInstalled.length > 0 ? (
					<div>
						<p className="mb-2 text-sm font-semibold text-foreground">
							Other downloaded models
						</p>
						<div className="overflow-hidden rounded-lg border">
							{otherInstalled.map(([name, model]) =>
								renderModelRow(name, {
									title: model.name,
									details: [
										formatGb(model.sizeBytes),
										model.parameterSize,
										model.quantization,
									]
										.filter(Boolean)
										.join(" · "),
								}),
							)}
						</div>
					</div>
				) : null}

				<p className="text-xs text-muted-foreground">
					Models loaded here stay in memory until you unload them. A model
					Ollama loads on its own, when a message arrives for it, is unloaded
					after a few minutes idle (configurable with{" "}
					<code>OLLAMA_KEEP_ALIVE</code>). The server URL can be changed under
					Providers → Ollama.
				</p>
			</section>
		</PageFrame>
	);
}
