import { StringRequest } from "@shared/proto/cline/common"
import { OpenAiModelsRequest } from "@shared/proto/cline/models"
import type { Mode } from "@shared/storage/types"
import { RefreshCwIcon, SlidersHorizontalIcon } from "lucide-react"
import type React from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useApiConfigurationHandlers } from "@/components/settings/utils/useApiConfigurationHandlers"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useNormalizedApiConfiguration } from "@/hooks/useNormalizedApiConfiguration"
import { fromProtobufProviderModelOverrides, useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModels } from "@/hooks/useProviderModels"
import { ModelsServiceClient } from "@/services/grpc-client"

const CONTEXT_WINDOW_PRESETS = [
	{ value: 4096, label: "4k" },
	{ value: 8192, label: "8k" },
	{ value: 16384, label: "16k" },
	{ value: 32768, label: "32k" },
	{ value: 65536, label: "64k" },
	{ value: 131072, label: "128k" },
	{ value: 200000, label: "200k" },
	{ value: 262144, label: "256k" },
	{ value: 524288, label: "512k" },
	{ value: 1000000, label: "1M" },
]

function formatCtxLabel(val: number): string {
	if (val >= 1_000_000) {
		return `${(val / 1_000_000).toFixed(val % 1_000_000 === 0 ? 0 : 1)}M`
	}
	if (val >= 1000) {
		return `${Math.round(val / 1024)}k`
	}
	return String(val)
}

interface QuickModelContextControlsProps {
	mode: Mode
	cloudActOnly: boolean
	onOpenApiSettings: () => void
}

export const QuickModelContextControls: React.FC<QuickModelContextControlsProps> = ({
	mode,
	cloudActOnly,
	onOpenApiSettings,
}) => {
	const { apiConfiguration, planActSeparateModelsSetting } = useExtensionState()
	const { selectedProvider, selectedModelId, selectedModelInfo } = useNormalizedApiConfiguration(mode)
	const { handleFieldChange } = useApiConfigurationHandlers()
	const { config, write, commitSelection } = useProviderConfig(selectedProvider)
	const { models: catalogModels, refresh: refreshCatalog } = useProviderModels(selectedProvider)

	const [dynamicModels, setDynamicModels] = useState<string[]>([])
	const [isRefreshing, setIsRefreshing] = useState(false)

	const isOpenAiCompat = selectedProvider === "openai" || (selectedProvider as string) === "openai-compatible"
	const isOllama = selectedProvider === "ollama"
	const isLmStudio = selectedProvider === "lmstudio"
	const supportsDynamicFetch = isOpenAiCompat || isOllama || isLmStudio

	const fetchDynamicModels = useCallback(async () => {
		if (cloudActOnly) {
			return
		}
		setIsRefreshing(true)
		try {
			if (isOpenAiCompat) {
				const baseUrl = config?.baseUrl || apiConfiguration?.openAiBaseUrl || ""
				const apiKey = apiConfiguration?.openAiApiKey || ""
				if (baseUrl) {
					const res = await ModelsServiceClient.refreshOpenAiModels(
						OpenAiModelsRequest.create({ baseUrl, apiKey }),
					)
					setDynamicModels(res.values ?? [])
				}
			} else if (isOllama) {
				const baseUrl = config?.baseUrl || apiConfiguration?.ollamaBaseUrl || ""
				const res = await ModelsServiceClient.getOllamaModels(StringRequest.create({ value: baseUrl }))
				setDynamicModels(res.values ?? [])
			} else if (isLmStudio) {
				const baseUrl = config?.baseUrl || apiConfiguration?.lmStudioBaseUrl || ""
				const res = await ModelsServiceClient.getLmStudioModels(StringRequest.create({ value: baseUrl }))
				setDynamicModels(res.values ?? [])
			} else {
				await refreshCatalog()
			}
		} catch (err) {
			console.error("Failed to fetch models for quick selector:", err)
		} finally {
			setIsRefreshing(false)
		}
	}, [
		cloudActOnly,
		isOpenAiCompat,
		isOllama,
		isLmStudio,
		config?.baseUrl,
		apiConfiguration?.openAiBaseUrl,
		apiConfiguration?.openAiApiKey,
		apiConfiguration?.ollamaBaseUrl,
		apiConfiguration?.lmStudioBaseUrl,
		refreshCatalog,
	])

	useEffect(() => {
		setDynamicModels([])
		if (supportsDynamicFetch) {
			void fetchDynamicModels()
		}
	}, [selectedProvider, config?.baseUrl, supportsDynamicFetch, fetchDynamicModels])

	const modelOptions = useMemo(() => {
		const set = new Set<string>()
		if (selectedModelId) {
			set.add(selectedModelId)
		}
		for (const id of dynamicModels) {
			if (id?.trim()) {
				set.add(id.trim())
			}
		}
		for (const id of Object.keys(catalogModels)) {
			if (id?.trim()) {
				set.add(id.trim())
			}
		}
		return Array.from(set)
	}, [selectedModelId, dynamicModels, catalogModels])

	const committedSelection = mode === "plan" ? config?.planSelection : config?.actSelection
	const currentOverrides = useMemo(
		() => fromProtobufProviderModelOverrides(committedSelection?.overrides) ?? {},
		[committedSelection?.overrides],
	)

	const activeContextWindow = useMemo(() => {
		if (currentOverrides.contextWindow && currentOverrides.contextWindow > 0) {
			return currentOverrides.contextWindow
		}
		if (isOllama) {
			const ollamaCtx = config?.contextWindow || Number.parseInt(apiConfiguration?.ollamaApiOptionsCtxNum || "", 10)
			if (Number.isFinite(ollamaCtx) && ollamaCtx > 0) {
				return ollamaCtx
			}
		}
		if (selectedModelInfo?.contextWindow && selectedModelInfo.contextWindow > 0) {
			return selectedModelInfo.contextWindow
		}
		return 131072
	}, [
		currentOverrides.contextWindow,
		isOllama,
		config?.contextWindow,
		apiConfiguration?.ollamaApiOptionsCtxNum,
		selectedModelInfo?.contextWindow,
	])

	const contextOptions = useMemo(() => {
		const hasActive = CONTEXT_WINDOW_PRESETS.some((p) => p.value === activeContextWindow)
		if (hasActive) {
			return CONTEXT_WINDOW_PRESETS
		}
		return [
			...CONTEXT_WINDOW_PRESETS,
			{ value: activeContextWindow, label: formatCtxLabel(activeContextWindow) },
		].sort((a, b) => a.value - b.value)
	}, [activeContextWindow])

	const commitForTargetModes = useCallback(
		async (modelId: string, overrides?: typeof currentOverrides) => {
			const modes: Mode[] = planActSeparateModelsSetting ? [mode] : ["plan", "act"]
			for (const targetMode of modes) {
				await commitSelection(targetMode, {
					providerId: selectedProvider,
					modelId,
					...(overrides !== undefined ? { overrides } : {}),
				})
			}
		},
		[commitSelection, mode, planActSeparateModelsSetting, selectedProvider],
	)

	const handleModelSelect = useCallback(
		async (e: React.ChangeEvent<HTMLSelectElement>) => {
			const nextModelId = e.target.value.trim()
			if (!nextModelId || nextModelId === selectedModelId) {
				return
			}
			try {
				await commitForTargetModes(nextModelId)
			} catch (err) {
				console.error("Failed to switch model:", err)
			}
		},
		[commitForTargetModes, selectedModelId],
	)

	const handleContextWindowSelect = useCallback(
		async (e: React.ChangeEvent<HTMLSelectElement>) => {
			const nextCtx = Number.parseInt(e.target.value, 10)
			if (!Number.isFinite(nextCtx) || nextCtx <= 0) {
				return
			}
			try {
				if (isOllama) {
					await write({ contextWindow: nextCtx })
					await handleFieldChange("ollamaApiOptionsCtxNum", String(nextCtx))
				}
				if (isLmStudio) {
					await handleFieldChange("lmStudioMaxTokens", String(nextCtx))
				}
				if (selectedModelId) {
					await commitForTargetModes(selectedModelId, {
						...currentOverrides,
						contextWindow: nextCtx,
					})
				}
			} catch (err) {
				console.error("Failed to update context window:", err)
			}
		},
		[commitForTargetModes, currentOverrides, handleFieldChange, isLmStudio, isOllama, selectedModelId, write],
	)

	if (cloudActOnly) {
		return null
	}

	return (
		<div className="flex items-center gap-1.5 min-w-0 flex-1 ml-1">
			{/* Inline Model Select */}
			<Tooltip>
				<TooltipContent side="top">
					Cambia modello ({selectedProvider}) — {selectedModelId || "nessun modello"}
				</TooltipContent>
				<TooltipTrigger asChild>
					<select
						aria-label="Select AI model"
						className="h-6 max-w-[230px] min-w-[110px] truncate rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.07] hover:border-white/[0.15] px-2 pr-5 font-geist-mono text-[11px] text-[#cfd4dc] hover:text-[#f2f4f7] focus:outline-none focus:border-white/[0.25] cursor-pointer transition-colors"
						data-testid="quick-model-select"
						onChange={handleModelSelect}
						style={{ colorScheme: "dark" }}
						value={selectedModelId || ""}>
						{modelOptions.length === 0 && <option value="">Nessun modello...</option>}
						{modelOptions.map((id) => (
							<option className="bg-[#151618] text-[#eceef0]" key={id} value={id}>
								{id}
							</option>
						))}
					</select>
				</TooltipTrigger>
			</Tooltip>

			{/* Refresh models button */}
			<Tooltip>
				<TooltipContent side="top">Aggiorna lista modelli dal server</TooltipContent>
				<TooltipTrigger asChild>
					<button
						aria-label="Refresh models"
						className="size-6 shrink-0 inline-flex items-center justify-center rounded-md bg-transparent hover:bg-white/[0.07] border-0 text-[#7c828b] hover:text-[#eceef0] cursor-pointer transition-colors"
						disabled={isRefreshing}
						onClick={() => void fetchDynamicModels()}
						type="button">
						<RefreshCwIcon className={isRefreshing ? "animate-spin" : ""} size={11.5} strokeWidth={1.9} />
					</button>
				</TooltipTrigger>
			</Tooltip>

			{/* Inline Context Window Select */}
			<Tooltip>
				<TooltipContent side="top">Context Window ({activeContextWindow.toLocaleString()} token)</TooltipContent>
				<TooltipTrigger asChild>
					<select
						aria-label="Context window size"
						className="h-6 shrink-0 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.07] hover:border-white/[0.15] px-1.5 font-geist-mono text-[11px] tabular-nums text-[#9ea4ad] hover:text-[#f2f4f7] focus:outline-none focus:border-white/[0.25] cursor-pointer transition-colors"
						data-testid="quick-ctx-select"
						onChange={handleContextWindowSelect}
						style={{ colorScheme: "dark" }}
						value={activeContextWindow}>
						{contextOptions.map((opt) => (
							<option className="bg-[#151618] text-[#eceef0]" key={opt.value} value={opt.value}>
								Ctx {opt.label}
							</option>
						))}
					</select>
				</TooltipTrigger>
			</Tooltip>

			{/* Quick API Settings trigger */}
			<Tooltip>
				<TooltipContent side="top">Configurazione Provider & API</TooltipContent>
				<TooltipTrigger asChild>
					<button
						aria-label="Open API Settings"
						className="size-6 shrink-0 inline-flex items-center justify-center rounded-md bg-transparent hover:bg-white/[0.07] border-0 text-[#7c828b] hover:text-[#eceef0] cursor-pointer transition-colors"
						onClick={onOpenApiSettings}
						type="button">
						<SlidersHorizontalIcon size={11.5} strokeWidth={1.9} />
					</button>
				</TooltipTrigger>
			</Tooltip>
		</div>
	)
}
