import {
	DEFAULT_LOCAL_CONTEXT_WINDOW,
	evaluateLocalModelFit,
	getLocalMemoryBudget,
	getRecommendedLocalModel,
	LOCAL_MODEL_CATALOG,
	type LocalModelCatalogEntry,
	type LocalModelFit,
	normalizeOllamaModelName,
} from "@shared/local-models"
import { StringRequest } from "@shared/proto/cline/common"
import {
	type LocalHardwareInfo,
	type LocalModelsStatus,
	OllamaModelRequest,
	type OllamaRunningModel,
} from "@shared/proto/cline/models"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { Download, Loader2, Play, RefreshCw, Square, Trash2, X } from "lucide-react"
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useEvent } from "react-use"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { ModelsServiceClient } from "@/services/grpc-client"
import Section from "../Section"

interface LocalModelsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

interface PullState {
	status: string
	completed: number
	total: number
}

type ModelAction = "using" | "loading" | "unloading" | "deleting"

const FIT_LABELS: Record<LocalModelFit, { text: string; className: string }> = {
	great: { text: "Runs well on this machine", className: "text-success" },
	slow: { text: "Will run slowly on this machine", className: "text-warning" },
	"too-large": { text: "Too large for this machine", className: "text-error" },
}

const formatGb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`
const formatContext = (tokens: number) => `${Math.round(tokens / 1024)}K context`

function describeHardware(hardware: LocalHardwareInfo): string {
	const memory = `${Math.round(hardware.totalMemoryGb)} GB`
	if (hardware.unifiedMemory) {
		return `${hardware.cpuModel} · ${memory} unified memory`
	}
	if (hardware.gpus.length > 0) {
		const gpus = hardware.gpus.map((gpu) => `${gpu.name} (${Math.round(gpu.memoryGb)} GB)`).join(", ")
		return `${gpus} · ${memory} RAM`
	}
	return `${hardware.cpuModel} · ${memory} RAM · No supported GPU detected`
}

function describeRunning(running: OllamaRunningModel): string {
	const placement =
		running.sizeVramBytes <= 0
			? "on CPU"
			: running.sizeVramBytes >= running.sizeBytes
				? "on GPU"
				: `${Math.round((running.sizeVramBytes / running.sizeBytes) * 100)}% on GPU`
	const parts = [`Loaded ${placement}`, formatGb(running.sizeBytes)]
	if (running.contextLength > 0) {
		parts.push(formatContext(running.contextLength))
	}
	// Ollama reports models pinned with keep_alive -1 as expiring centuries from now.
	const oneYearMs = 365 * 24 * 60 * 60 * 1000
	if (running.expiresAtMs - Date.now() >= oneYearMs) {
		parts.push("stays loaded until unloaded")
	} else if (running.expiresAtMs > 0) {
		const time = new Date(running.expiresAtMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
		parts.push(`unloads at ${time} if idle`)
	}
	return parts.join(" · ")
}

const LocalModelsSection = ({ renderSectionHeader }: LocalModelsSectionProps) => {
	const { apiConfiguration, mode, planActSeparateModelsSetting } = useExtensionState()
	const { config, write, commitSelection } = useProviderConfig("ollama")
	const baseUrl = config?.baseUrl ?? apiConfiguration?.ollamaBaseUrl ?? ""

	const [status, setStatus] = useState<LocalModelsStatus | undefined>(undefined)
	const [refreshing, setRefreshing] = useState(false)
	const [pulls, setPulls] = useState<Record<string, PullState>>({})
	const [actions, setActions] = useState<Record<string, ModelAction>>({})
	const [errors, setErrors] = useState<Record<string, string>>({})
	const pullSubscriptions = useRef(new Map<string, () => void>())

	const setModelError = useCallback((model: string, message: string | undefined) => {
		setErrors(({ [model]: _, ...rest }) => (message ? { ...rest, [model]: message } : rest))
	}, [])

	const refresh = useCallback(async () => {
		setRefreshing(true)
		try {
			setStatus(await ModelsServiceClient.getLocalModelsStatus(StringRequest.create({ value: baseUrl })))
		} catch (error) {
			console.error("Failed to read local models status:", error)
		} finally {
			setRefreshing(false)
		}
	}, [baseUrl])

	const subscribeToPull = useCallback(
		(model: string) => {
			if (pullSubscriptions.current.has(model)) {
				return
			}
			setModelError(model, undefined)
			setPulls((prev) => ({ ...prev, [model]: prev[model] ?? { status: "starting", completed: 0, total: 0 } }))
			const finish = () => {
				pullSubscriptions.current.delete(model)
				setPulls(({ [model]: _, ...rest }) => rest)
				void refresh()
			}
			const cancel = ModelsServiceClient.pullOllamaModel(OllamaModelRequest.create({ baseUrl, model }), {
				onResponse: (progress) => {
					if (progress.status !== "success") {
						setPulls((prev) => ({ ...prev, [model]: progress }))
					}
				},
				onError: (error) => {
					if (error.message !== "Download cancelled") {
						setModelError(model, error.message)
					}
				},
				onComplete: finish,
			})
			pullSubscriptions.current.set(model, cancel)
		},
		[baseUrl, refresh, setModelError],
	)

	useEffect(() => {
		void refresh()
	}, [refresh])

	// Unsubscribing leaves downloads running on the host; reopening this page picks them back up.
	useEffect(() => {
		for (const pull of status?.activePulls ?? []) {
			subscribeToPull(pull.model)
		}
	}, [status, subscribeToPull])
	useEffect(() => {
		const subscriptions = pullSubscriptions.current
		return () => {
			for (const cancel of subscriptions.values()) {
				cancel()
			}
			subscriptions.clear()
		}
	}, [])

	// Loaded models can be unloaded by Ollama's idle timeout or from outside Cline.
	useEvent("focus", () => void refresh())
	const nextExpiryMs = useMemo(() => {
		const expiries = (status?.running ?? []).map((model) => model.expiresAtMs).filter((ms) => ms > Date.now())
		return expiries.length > 0 ? Math.min(...expiries) : undefined
	}, [status])
	useEffect(() => {
		if (!nextExpiryMs || nextExpiryMs - Date.now() > 60 * 60 * 1000) {
			return
		}
		const timer = setTimeout(() => void refresh(), nextExpiryMs - Date.now() + 1000)
		return () => clearTimeout(timer)
	}, [nextExpiryMs, refresh])

	const runAction = useCallback(
		async (model: string, action: ModelAction, run: () => Promise<unknown>) => {
			setActions((prev) => ({ ...prev, [model]: action }))
			setModelError(model, undefined)
			try {
				await run()
			} catch (error) {
				setModelError(model, error instanceof Error ? error.message : String(error))
			} finally {
				setActions(({ [model]: _, ...rest }) => rest)
				void refresh()
			}
		},
		[refresh, setModelError],
	)

	const currentProvider = mode === "plan" ? apiConfiguration?.planModeApiProvider : apiConfiguration?.actModeApiProvider
	const selectedModelId = (mode === "plan" ? config?.planSelection : config?.actSelection)?.modelId
	const activeModel = currentProvider === "ollama" && selectedModelId ? normalizeOllamaModelName(selectedModelId) : undefined

	const contextWindowFor = useCallback(
		(model: string) => {
			if (model === activeModel && config?.contextWindow) {
				return config.contextWindow
			}
			return (
				LOCAL_MODEL_CATALOG.find((entry) => normalizeOllamaModelName(entry.id) === model)?.contextWindow ??
				DEFAULT_LOCAL_CONTEXT_WINDOW
			)
		},
		[activeModel, config?.contextWindow],
	)

	const loadModel = useCallback(
		(model: string) =>
			ModelsServiceClient.loadOllamaModel(
				OllamaModelRequest.create({ baseUrl, model, contextWindow: contextWindowFor(model) }),
			),
		[baseUrl, contextWindowFor],
	)

	const useWithCline = useCallback(
		(model: string, contextWindow: number) =>
			runAction(model, "using", async () => {
				await write({ contextWindow })
				const modes = planActSeparateModelsSetting ? [mode] : (["plan", "act"] as const)
				for (const targetMode of modes) {
					await commitSelection(targetMode, { providerId: "ollama", modelId: model })
				}
				// Warm the model up so the first message doesn't wait on a cold load.
				await ModelsServiceClient.loadOllamaModel(OllamaModelRequest.create({ baseUrl, model, contextWindow }))
			}),
		[baseUrl, commitSelection, mode, planActSeparateModelsSetting, runAction, write],
	)

	const installed = useMemo(
		() => new Map((status?.installed ?? []).map((model) => [normalizeOllamaModelName(model.name), model])),
		[status],
	)
	const running = useMemo(
		() => new Map((status?.running ?? []).map((model) => [normalizeOllamaModelName(model.name), model])),
		[status],
	)
	const hardware = status?.hardware
	const recommended = hardware ? getRecommendedLocalModel(hardware) : undefined
	const catalogIds = new Set(LOCAL_MODEL_CATALOG.map((entry) => normalizeOllamaModelName(entry.id)))
	const otherInstalled = [...installed.entries()].filter(([name]) => !catalogIds.has(name))
	const reachable = status?.ollamaReachable ?? false

	const renderModelRow = (
		model: string,
		{ title, entry, details }: { title: string; entry?: LocalModelCatalogEntry; details: ReactNode },
	) => {
		const name = normalizeOllamaModelName(model)
		const isInstalled = installed.has(name)
		const runningModel = running.get(name)
		const pull = pulls[model]
		const action = actions[name]
		const error = errors[model] ?? errors[name]
		const isActive = name === activeModel
		const fit = entry && hardware ? evaluateLocalModelFit(entry.memoryGb, hardware) : undefined
		const pullPercent = pull && pull.total > 0 ? (pull.completed / pull.total) * 100 : 0

		return (
			<div className="flex flex-col gap-1.5 p-3 rounded-sm border border-editor-group-border" key={model}>
				<div className="flex items-center gap-2 flex-wrap">
					<span className="font-semibold">{title}</span>
					{entry && entry === recommended && <Badge variant="cline">Recommended for you</Badge>}
					{isActive && <Badge variant="success">In use</Badge>}
					{entry?.tags.map((tag) => (
						<Badge key={tag} variant="outline">
							{tag}
						</Badge>
					))}
				</div>
				{entry && <p className="text-xs text-description m-0">{entry.description}</p>}
				<div className="text-xs text-description">
					{details}
					{fit && <span className={FIT_LABELS[fit].className}> · {FIT_LABELS[fit].text}</span>}
				</div>
				{runningModel && (
					<div className="text-xs flex items-center gap-1.5">
						<span className="inline-block size-2 rounded-full bg-success" />
						{describeRunning(runningModel)}
					</div>
				)}
				{pull && (
					<div className="flex flex-col gap-1">
						<Progress className="h-1.5" value={pullPercent} />
						<div className="text-xs text-description flex justify-between gap-2">
							<span className="truncate">
								{pull.status.startsWith("pulling") && pull.total > 0
									? `Downloading ${formatGb(pull.completed)} of ${formatGb(pull.total)}`
									: pull.status}
							</span>
							{pull.total > 0 && <span>{Math.floor(pullPercent)}%</span>}
						</div>
					</div>
				)}
				{error && <p className="text-xs text-error m-0 break-words">{error}</p>}
				<div className="flex gap-2 flex-wrap mt-1">
					{!isInstalled && !pull && (
						<Button
							disabled={!reachable}
							onClick={() => subscribeToPull(model)}
							size="sm"
							variant={fit === "too-large" ? "secondary" : "default"}>
							<Download />
							Download{entry ? ` (${entry.sizeGb} GB)` : ""}
						</Button>
					)}
					{pull && (
						<Button
							onClick={() =>
								void ModelsServiceClient.cancelOllamaPull(OllamaModelRequest.create({ baseUrl, model }))
							}
							size="sm"
							variant="secondary">
							<X />
							Cancel
						</Button>
					)}
					{isInstalled && !isActive && (
						<Button
							disabled={!!action}
							onClick={() => void useWithCline(name, entry?.contextWindow ?? DEFAULT_LOCAL_CONTEXT_WINDOW)}
							size="sm">
							{action === "using" ? <Loader2 className="animate-spin" /> : null}
							Use with Cline
						</Button>
					)}
					{isInstalled && !runningModel && (
						<Button
							disabled={!!action}
							onClick={() => void runAction(name, "loading", () => loadModel(name))}
							size="sm"
							variant="secondary">
							{action === "loading" ? <Loader2 className="animate-spin" /> : <Play />}
							{action === "loading" ? "Loading…" : "Load"}
						</Button>
					)}
					{runningModel && (
						<Button
							disabled={!!action}
							onClick={() =>
								void runAction(name, "unloading", () =>
									ModelsServiceClient.unloadOllamaModel(OllamaModelRequest.create({ baseUrl, model: name })),
								)
							}
							size="sm"
							variant="secondary">
							{action === "unloading" ? <Loader2 className="animate-spin" /> : <Square />}
							Unload
						</Button>
					)}
					{isInstalled && (
						<Button
							aria-label={`Delete ${title}`}
							disabled={!!action}
							onClick={() =>
								void runAction(name, "deleting", () =>
									ModelsServiceClient.deleteOllamaModel(OllamaModelRequest.create({ baseUrl, model: name })),
								)
							}
							size="sm"
							title="Delete from disk"
							variant="ghost">
							{action === "deleting" ? <Loader2 className="animate-spin" /> : <Trash2 />}
						</Button>
					)}
				</div>
			</div>
		)
	}

	const budget = hardware ? getLocalMemoryBudget(hardware) : undefined

	return (
		<div>
			{renderSectionHeader("local-models")}
			<Section>
				<p className="text-sm text-description m-0">
					Run models on your own machine with{" "}
					<VSCodeLink href="https://ollama.com" style={{ display: "inline", fontSize: "inherit" }}>
						Ollama
					</VSCodeLink>
					. Download one, then click <span className="font-semibold">Use with Cline</span> to switch Cline to it with
					the right settings.
				</p>

				{hardware && (
					<div className="flex flex-col gap-1 p-3 rounded-sm bg-code-block-background">
						<span className="text-xs uppercase tracking-wide text-description">Your machine</span>
						<span className="text-sm">{describeHardware(hardware)}</span>
						{budget && (
							<span className="text-xs text-description">
								{budget.gpuGb > 0
									? `Models needing up to ~${Math.floor(budget.gpuGb)} GB run fully on the GPU.`
									: "Without a supported GPU, models run on the CPU and respond slowly."}
							</span>
						)}
					</div>
				)}

				<div className="flex items-center gap-2 text-sm">
					<span className={`inline-block size-2 rounded-full ${reachable ? "bg-success" : "bg-error"}`} />
					<span className="flex-1">
						{!status
							? "Checking for Ollama…"
							: reachable
								? `Ollama ${status.ollamaVersion} is running`
								: "Ollama isn't running"}
					</span>
					<Button aria-label="Refresh" disabled={refreshing} onClick={() => void refresh()} size="icon" variant="icon">
						<RefreshCw className={refreshing ? "animate-spin" : ""} />
					</Button>
				</div>
				{status && !reachable && (
					<p className="text-xs text-description m-0">
						<VSCodeLink href="https://ollama.com/download" style={{ display: "inline", fontSize: "inherit" }}>
							Install Ollama
						</VSCodeLink>{" "}
						and start it (or run <code>ollama serve</code>). Cline looks for it at{" "}
						{baseUrl || "http://localhost:11434"}, which you can change in API Configuration.
					</p>
				)}

				<h4 className="m-0 mt-2">Recommended models</h4>
				{LOCAL_MODEL_CATALOG.map((entry) =>
					renderModelRow(entry.id, {
						title: entry.name,
						entry,
						details: `${entry.id} · ${entry.sizeGb} GB download · needs ~${entry.memoryGb} GB memory · ${formatContext(entry.contextWindow)}`,
					}),
				)}

				{otherInstalled.length > 0 && (
					<>
						<h4 className="m-0 mt-2">Other downloaded models</h4>
						{otherInstalled.map(([name, model]) =>
							renderModelRow(name, {
								title: model.name,
								details: [formatGb(model.sizeBytes), model.parameterSize, model.quantization]
									.filter(Boolean)
									.join(" · "),
							}),
						)}
					</>
				)}

				<p className="text-xs text-description m-0 mt-2">
					Models loaded here stay in memory until you unload them. A model Ollama loads on its own, when a message
					arrives for it, is unloaded after a few minutes idle (configurable with <code>OLLAMA_KEEP_ALIVE</code>). The
					context window and server URL can be adjusted under API Configuration → Ollama.
				</p>
			</Section>
		</div>
	)
}

export default LocalModelsSection
