"use client";

import {
	Download,
	Loader2,
	Play,
	SlidersHorizontal,
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
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { desktopClient } from "@/lib/desktop-client";
import {
	DEFAULT_LOCAL_CONTEXT_WINDOW,
	describeModelPlacement,
	describeUnloadTime,
	evaluateLocalModelFit,
	formatContext,
	formatGb,
	getLocalMemoryBudget,
	getMachineMemoryBytes,
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
import { PageFrame, PageHeader } from "../page-layout";
import { LocalModelDetailsDialog } from "./local-model-details-dialog";
import { OllamaSetup } from "./ollama-setup";

type ModelAction = "using" | "loading" | "unloading" | "deleting";
type InstalledModel = LocalModelsStatus["installed"][number];
type RunningModel = LocalModelsStatus["running"][number];

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

const CAPABILITY_LABELS: Record<string, string> = {
	tools: "Tools",
	thinking: "Thinking",
	vision: "Vision",
};

/** Polling interval while waiting for the user to install or start Ollama. */
const WAITING_FOR_OLLAMA_POLL_MS = 3000;

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

function describeRunning(running: RunningModel) {
	return [
		`Loaded ${describeModelPlacement(running)}`,
		formatGb(running.sizeBytes),
		running.contextLength > 0 ? formatContext(running.contextLength) : "",
		describeUnloadTime(running.expiresAtMs) ?? "",
	]
		.filter(Boolean)
		.join(" · ");
}

function describeInstalled(model: InstalledModel) {
	return [
		formatGb(model.sizeBytes),
		model.parameterSize,
		model.quantization,
		...model.capabilities
			.map((capability) => CAPABILITY_LABELS[capability])
			.filter(Boolean),
		model.contextLength > 0
			? `up to ${formatContext(model.contextLength)}`
			: "",
	]
		.filter(Boolean)
		.join(" · ");
}

function SectionHeading({
	title,
	aside,
}: {
	title: string;
	aside?: ReactNode;
}) {
	return (
		<div className="mb-2 flex items-baseline justify-between gap-3">
			<p className="text-sm font-semibold text-foreground">{title}</p>
			{aside ? (
				<span className="text-xs text-muted-foreground">{aside}</span>
			) : null}
		</div>
	);
}

function StorageBar({
	modelsBytes,
	disk,
}: {
	modelsBytes: number;
	disk: NonNullable<LocalModelsStatus["disk"]>;
}) {
	const percent = (bytes: number) =>
		`${Math.max(0, Math.min(100, (bytes / disk.totalBytes) * 100))}%`;
	const otherBytes = Math.max(
		0,
		disk.totalBytes - disk.freeBytes - modelsBytes,
	);
	return (
		<div className="mb-3 flex flex-col gap-1.5">
			<div className="flex h-2 overflow-hidden rounded-full bg-muted">
				<div className="bg-primary" style={{ width: percent(modelsBytes) }} />
				<div
					className="bg-muted-foreground/30"
					style={{ width: percent(otherBytes) }}
				/>
			</div>
			<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
				<span className="flex items-center gap-1.5">
					<span className="inline-block size-2 rounded-full bg-primary" />
					Models {formatGb(modelsBytes)}
				</span>
				<span className="flex items-center gap-1.5">
					<span className="inline-block size-2 rounded-full bg-muted-foreground/30" />
					Other files {formatGb(otherBytes)}
				</span>
				<span className="flex items-center gap-1.5">
					<span className="inline-block size-2 rounded-full border bg-muted" />
					Free {formatGb(disk.freeBytes)}
				</span>
			</div>
		</div>
	);
}

export function LocalModelsContent() {
	const [status, setStatus] = useState<LocalModelsStatus>();
	const [refreshing, setRefreshing] = useState(false);
	const [pulls, setPulls] = useState<Record<string, OllamaPullProgress>>({});
	const [actions, setActions] = useState<Record<string, ModelAction>>({});
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [activeModel, setActiveModel] = useState(readActiveOllamaModel);
	const [detailsModel, setDetailsModel] = useState<string>();
	const [pendingDelete, setPendingDelete] = useState<InstalledModel>();

	const setModelError = useCallback(
		(model: string, message: string | undefined) => {
			setErrors(({ [model]: _, ...rest }) =>
				message ? { ...rest, [model]: message } : rest,
			);
		},
		[],
	);

	const refresh = useCallback(async ({ quiet = false } = {}) => {
		if (!quiet) setRefreshing(true);
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
			if (!quiet) setRefreshing(false);
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

	const reachable = status?.ollamaReachable ?? false;
	// Pick Ollama up as soon as the user finishes installing or starting it.
	useEffect(() => {
		if (!status || reachable) {
			return;
		}
		const timer = window.setInterval(
			() => void refresh({ quiet: true }),
			WAITING_FOR_OLLAMA_POLL_MS,
		);
		return () => window.clearInterval(timer);
	}, [reachable, refresh, status]);

	const startOllama = useCallback(async () => {
		const { started } = await desktopClient.invoke<{ started: boolean }>(
			"start_ollama",
			undefined,
			{ timeoutMs: 30_000 },
		);
		await refresh();
		if (!started) {
			throw new Error(
				"Ollama didn't respond within 20 seconds. Try opening it yourself.",
			);
		}
	}, [refresh]);

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

	const catalogEntryFor = (model: string) =>
		LOCAL_MODEL_CATALOG.find(
			(entry) => normalizeOllamaModelName(entry.id) === model,
		);

	const contextWindowFor = (model: string) => {
		if (model === activeModel && status?.contextWindow) {
			return status.contextWindow;
		}
		return (
			catalogEntryFor(model)?.contextWindow ?? DEFAULT_LOCAL_CONTEXT_WINDOW
		);
	};

	const loadModel = (model: string, contextWindow: number) =>
		// Loading a large model can take minutes.
		desktopClient.invoke(
			"load_ollama_model",
			{ model, contextWindow },
			{ timeoutMs: null },
		);

	const unloadModel = (model: string) =>
		runAction(model, "unloading", () =>
			desktopClient.invoke("unload_ollama_model", { model }),
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
	const disk = status?.disk;
	const recommended = hardware ? getRecommendedLocalModel(hardware) : undefined;
	const installedBySize = [...installed.entries()].sort(
		([, a], [, b]) => b.sizeBytes - a.sizeBytes,
	);
	const modelsBytes = installedBySize.reduce(
		(sum, [, model]) => sum + model.sizeBytes,
		0,
	);
	const machineMemoryBytes = hardware ? getMachineMemoryBytes(hardware) : 0;
	const loadedBytes = [...running.values()].reduce(
		(sum, model) => sum + model.sizeBytes,
		0,
	);

	const renderModelRow = (
		model: string,
		{
			title,
			entry,
			details,
			section,
		}: {
			title: string;
			entry?: LocalModelCatalogEntry;
			details: ReactNode;
			section: "recommended" | "downloaded";
		},
	) => {
		const name = normalizeOllamaModelName(model);
		const installedModel = installed.get(name);
		const runningModel = running.get(name);
		const pull = pulls[model];
		const action = actions[name];
		const error = errors[model] ?? errors[name];
		const isActive = name === activeModel;
		// Catalog models are run from the recommended list; the downloaded list is for storage.
		const showRunControls = section === "recommended" || !catalogEntryFor(name);
		const fit =
			section === "recommended" && entry && hardware
				? evaluateLocalModelFit(entry.memoryGb, hardware)
				: undefined;
		const pullPercent =
			pull && pull.total > 0 ? (pull.completed / pull.total) * 100 : 0;
		const notEnoughDisk =
			!!entry && !!disk && entry.sizeGb * 1e9 > disk.freeBytes;

		return (
			<div
				className="flex flex-col gap-2 border-b px-4 py-4 last:border-b-0"
				key={`${section}-${model}`}
			>
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-sm font-semibold text-foreground">{title}</span>
					{section === "recommended" && entry && entry === recommended ? (
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
					{section === "recommended" && installedModel ? (
						<Badge variant="outline">Downloaded</Badge>
					) : null}
					{section === "recommended"
						? entry?.tags.map((tag) => (
								<Badge key={tag} variant="muted">
									{tag}
								</Badge>
							))
						: null}
				</div>
				{section === "recommended" && entry ? (
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
				<div className="mt-1 flex flex-wrap items-center gap-2">
					{!installedModel && !pull ? (
						<Button
							disabled={!reachable || notEnoughDisk}
							onClick={() => void startPull(model)}
							size="sm"
							type="button"
							variant={fit === "too-large" ? "outline" : "default"}
						>
							<Download />
							Download{entry ? ` (${entry.sizeGb} GB)` : ""}
						</Button>
					) : null}
					{!installedModel && !pull && notEnoughDisk && disk ? (
						<span className="text-xs text-destructive">
							Not enough disk space ({formatGb(disk.freeBytes)} free)
						</span>
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
					{installedModel && showRunControls && !isActive ? (
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
					{installedModel && showRunControls && !runningModel ? (
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
					{runningModel && showRunControls ? (
						<Button
							disabled={!!action}
							onClick={() => void unloadModel(name)}
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
					{installedModel ? (
						<Button
							onClick={() => setDetailsModel(name)}
							size="sm"
							type="button"
							variant="ghost"
						>
							<SlidersHorizontal />
							Details
						</Button>
					) : null}
					{installedModel && section === "downloaded" ? (
						<Button
							disabled={!!action}
							onClick={() => setPendingDelete(installedModel)}
							size="sm"
							type="button"
							variant="ghost"
						>
							{action === "deleting" ? (
								<Loader2 className="animate-spin" />
							) : (
								<Trash2 />
							)}
							Delete
						</Button>
					) : null}
				</div>
			</div>
		);
	};

	const budget = hardware ? getLocalMemoryBudget(hardware) : undefined;
	const deleteName = pendingDelete
		? normalizeOllamaModelName(pendingDelete.name)
		: undefined;

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

				<OllamaSetup
					onRefresh={() => void refresh()}
					onStart={startOllama}
					refreshing={refreshing}
					status={status}
				/>

				{running.size > 0 ? (
					<div>
						<SectionHeading
							aside={
								machineMemoryBytes > 0
									? `${formatGb(loadedBytes)} of ${formatGb(machineMemoryBytes)} memory`
									: undefined
							}
							title="Loaded in memory"
						/>
						<div className="overflow-hidden rounded-lg border">
							{[...running.entries()].map(([name, model]) => (
								<div
									className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0"
									key={name}
								>
									<div className="flex min-w-0 flex-1 flex-col gap-1.5">
										<div className="flex items-center gap-2">
											<span className="inline-block size-2 shrink-0 rounded-full bg-emerald-500" />
											<span className="truncate text-sm font-medium text-foreground">
												{name}
											</span>
											{name === activeModel ? (
												<Badge
													className="border-emerald-400/50 text-emerald-600 dark:text-emerald-400"
													variant="outline"
												>
													In use
												</Badge>
											) : null}
										</div>
										{machineMemoryBytes > 0 ? (
											<Progress
												aria-label={`${name} memory use`}
												className="h-1.5 max-w-md"
												value={(model.sizeBytes / machineMemoryBytes) * 100}
											/>
										) : null}
										<span className="text-xs text-muted-foreground">
											{describeRunning(model)}
										</span>
										{errors[name] ? (
											<span className="text-xs text-destructive" role="alert">
												{errors[name]}
											</span>
										) : null}
									</div>
									<Button
										disabled={!!actions[name]}
										onClick={() => void unloadModel(name)}
										size="sm"
										type="button"
										variant="outline"
									>
										{actions[name] === "unloading" ? (
											<Loader2 className="animate-spin" />
										) : (
											<Square />
										)}
										Unload
									</Button>
								</div>
							))}
						</div>
					</div>
				) : null}

				<div>
					<SectionHeading title="Recommended models" />
					<div className="overflow-hidden rounded-lg border">
						{LOCAL_MODEL_CATALOG.map((entry) =>
							renderModelRow(entry.id, {
								title: entry.name,
								entry,
								section: "recommended",
								details: `${entry.id} · ${entry.sizeGb} GB download · needs ~${entry.memoryGb} GB memory · ${formatContext(entry.contextWindow)}`,
							}),
						)}
					</div>
				</div>

				{installedBySize.length > 0 ? (
					<div>
						<SectionHeading
							aside={`${installedBySize.length} ${installedBySize.length === 1 ? "model" : "models"} · ${formatGb(modelsBytes)}`}
							title="Downloaded models"
						/>
						{disk ? <StorageBar disk={disk} modelsBytes={modelsBytes} /> : null}
						<div className="overflow-hidden rounded-lg border">
							{installedBySize.map(([name, model]) =>
								renderModelRow(name, {
									title: catalogEntryFor(name)?.name ?? model.name,
									section: "downloaded",
									details: catalogEntryFor(name)
										? `${model.name} · ${describeInstalled(model)}`
										: describeInstalled(model),
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

			<LocalModelDetailsDialog
				contextWindow={detailsModel ? contextWindowFor(detailsModel) : 0}
				model={detailsModel}
				onOpenChange={(open) => {
					if (!open) setDetailsModel(undefined);
				}}
				running={detailsModel ? running.get(detailsModel) : undefined}
				sizeBytes={
					detailsModel ? (installed.get(detailsModel)?.sizeBytes ?? 0) : 0
				}
			/>

			<AlertDialog
				onOpenChange={(open) => {
					if (!open) setPendingDelete(undefined);
				}}
				open={!!pendingDelete}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete {pendingDelete?.name}?</AlertDialogTitle>
						<AlertDialogDescription>
							This frees {formatGb(pendingDelete?.sizeBytes ?? 0)} on your disk.
							You can download it again anytime.
							{deleteName === activeModel
								? " Cline is set to use this model, so pick another one before your next message."
								: ""}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-white hover:bg-destructive/90"
							onClick={() => {
								if (deleteName) {
									void runAction(deleteName, "deleting", async () => {
										if (running.has(deleteName)) {
											await desktopClient.invoke("unload_ollama_model", {
												model: deleteName,
											});
										}
										await desktopClient.invoke("delete_ollama_model", {
											model: deleteName,
										});
									});
								}
							}}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</PageFrame>
	);
}
