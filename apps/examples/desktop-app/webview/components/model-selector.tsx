"use client";

import { CLINE_DEFAULT_MODEL_ID } from "@cline/shared/browser";
import { SearchCombobox, type SearchComboboxProps } from "@cline/ui";
import { Cpu, Plus } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";
import {
	buildModelPickerData,
	type ModelPickerData,
} from "@/lib/featured-models";
import {
	MODEL_SELECTION_CHANGED_EVENT,
	type ModelSelectionChangedDetail,
	readModelSelectionStorageFromWindow,
	writeModelSelectionStorageToWindow,
} from "@/lib/model-selection";
import { normalizeProviderId } from "@/lib/provider-id";
import {
	loadProviderModelCatalog,
	loadProviderModels,
	subscribeToProviderCatalogInvalidation,
	subscribeToProviderModels,
} from "@/lib/provider-model-catalog";
import { FALLBACK_PROVIDER_MODELS } from "@/lib/provider-model-defaults";
import type { ProviderModel } from "@/lib/provider-schema";
import { cn } from "@/lib/utils";

function hasReasoningCapability(
	providerReasoningModels: Record<string, string[]>,
	provider: string,
	model: string,
): boolean {
	const normalizedProvider = normalizeProviderId(provider);
	return (
		providerReasoningModels[normalizedProvider] ??
		providerReasoningModels[provider] ??
		[]
	).includes(model);
}

// Memoized: the selectors load/hold the full provider-model catalog, so they
// should not re-render for every keystroke in the composer textarea.
/** Sentinel provider-picker row that opens Settings → Providers instead of selecting. */
const ADD_PROVIDER_OPTION_VALUE = "__add-provider__";

type ModelSelectorBaseProps = {
	allowedProviderIds?: string[];
	autoCorrectModel?: boolean;
	className?: string;
	placement?: SearchComboboxProps["placement"];
	/** Follow and update the remembered chat choices, rather than only `provider` and `model`. */
	syncSelection: boolean;
	includeCloudModels?: boolean;
	provider: string;
	model: string;
	isBusy: boolean;
	onProviderChange: (provider: string) => void;
	onModelChange: (model: string) => void;
	onModelReadyChange?: (ready: boolean) => void;
	onModelSupportsReasoningChange?: (supportsReasoning: boolean | null) => void;
	onModelSupportsImagesChange?: (supported: boolean | null) => void;
	/** Opens Settings → Providers; adds a "set up another provider" row when set. */
	onOpenModelSettings?: () => void;
};
type ModelSelectorProps = Omit<ModelSelectorBaseProps, "syncSelection">;

function ModelSelectorBase({
	allowedProviderIds,
	autoCorrectModel = true,
	className,
	placement = "top",
	syncSelection,
	includeCloudModels = false,
	provider,
	model,
	isBusy,
	onProviderChange,
	onModelChange,
	onModelReadyChange,
	onModelSupportsReasoningChange,
	onModelSupportsImagesChange,
	onOpenModelSettings,
}: ModelSelectorBaseProps) {
	const [providerModels, setProviderModels] = useState<
		Record<string, string[]>
	>(includeCloudModels ? {} : FALLBACK_PROVIDER_MODELS);
	const [providerReasoningModels, setProviderReasoningModels] = useState<
		Record<string, string[]>
	>(FALLBACK_PROVIDER_MODELS);
	const [reasoningCapabilitySource, setReasoningCapabilitySource] = useState<
		"loading" | "catalog" | "fallback"
	>("loading");
	const [enabledProviderIds, setEnabledProviderIds] = useState<string[]>([]);
	const [providerNames, setProviderNames] = useState<Record<string, string>>(
		{},
	);
	const [modelDetails, setModelDetails] = useState<
		Record<string, ProviderModel[]>
	>({});
	const [lastSelection, setLastSelection] = useState(() =>
		includeCloudModels
			? { lastProvider: "", lastModelByProvider: {} }
			: readModelSelectionStorageFromWindow(),
	);
	const [catalogRevision, setCatalogRevision] = useState(0);
	// Remounted per execution target, so this reads the local provider as of entering Cloud.
	const [localClinePass] = useState(
		() =>
			includeCloudModels &&
			normalizeProviderId(
				readModelSelectionStorageFromWindow().lastProvider,
			) === "cline-pass",
	);
	const [mobileOpen, setMobileOpen] = useState(false);
	const normalizedProvider = includeCloudModels
		? (Object.keys(providerModels).find((id) =>
				providerModels[id]?.includes(model),
			) ??
			(model.startsWith("cline-pass/")
				? "cline-pass"
				: model.startsWith("cline-cloud/")
					? "cline-cloud"
					: "cline"))
		: normalizeProviderId(provider);
	useEffect(() => {
		if (!includeCloudModels) return;
		return desktopClient.subscribe("cloud_sessions_changed", () => {
			setProviderModels({});
			setEnabledProviderIds([]);
			setCatalogRevision((current) => current + 1);
		});
	}, [includeCloudModels]);
	useEffect(
		() =>
			subscribeToProviderCatalogInvalidation(() =>
				setCatalogRevision((current) => current + 1),
			),
		[],
	);
	const applyProviderModels = useCallback(
		(providerId: string, models: ProviderModel[]) => {
			setProviderModels((current) => ({
				...current,
				[providerId]: models.map((entry) => entry.id),
			}));
			setProviderReasoningModels((current) => ({
				...current,
				[providerId]: models
					.filter((entry) => entry.supportsReasoning)
					.map((entry) => entry.id),
			}));
			setModelDetails((current) => ({
				...current,
				[providerId]: models,
			}));
			setEnabledProviderIds((current) =>
				current.includes(providerId) ? current : [...current, providerId],
			);
		},
		[],
	);
	// Re-fetch only the live list on picker open so the Recommended/Free tiers
	// stay current. Re-running the full load would first re-apply the bundled
	// catalog and briefly flash a stale name in the trigger.
	const refreshActiveProviderModels = useCallback(() => {
		if (!normalizedProvider) return;
		if (includeCloudModels) {
			setCatalogRevision((current) => current + 1);
			return;
		}
		const loading = loadProviderModels(normalizedProvider);
		loading
			.then((models) => {
				if (models.length === 0) return;
				applyProviderModels(normalizedProvider, models);
				setReasoningCapabilitySource("catalog");
			})
			.catch(() => {
				// Keep the current list when the refresh fails.
			});
	}, [applyProviderModels, includeCloudModels, normalizedProvider]);
	const visibleProviderModels = useMemo(() => {
		const next: Record<string, string[]> = {};
		const providerIds = new Set(enabledProviderIds);
		// A draft's configured provider must survive unrelated live updates while
		// its initial catalog is still loading, including providers absent from it.
		if (!syncSelection && !includeCloudModels && normalizedProvider) {
			providerIds.add(normalizedProvider);
		}
		for (const providerId of providerIds) {
			if (allowedProviderIds && !allowedProviderIds.includes(providerId)) {
				continue;
			}
			next[providerId] = providerModels[providerId] ?? [];
		}
		return next;
	}, [
		allowedProviderIds,
		enabledProviderIds,
		includeCloudModels,
		normalizedProvider,
		providerModels,
		syncSelection,
	]);
	const providers = useMemo(
		() => Object.keys(visibleProviderModels),
		[visibleProviderModels],
	);
	const rememberedLastProvider = lastSelection.lastProvider.trim();
	const resolvedProvider = useMemo(() => {
		if (providers.length === 0) {
			return "";
		}
		const rememberedProvider = normalizeProviderId(rememberedLastProvider);
		if (normalizedProvider && providers.includes(normalizedProvider)) {
			return normalizedProvider;
		}
		if (rememberedProvider && providers.includes(rememberedProvider)) {
			return rememberedProvider;
		}
		return providers[0] ?? "";
	}, [normalizedProvider, providers, rememberedLastProvider]);
	useEffect(() => {
		onModelReadyChange?.(
			providers.includes(normalizedProvider) &&
				(providerModels[normalizedProvider]?.includes(model) ?? false),
		);
	}, [
		model,
		normalizedProvider,
		onModelReadyChange,
		providerModels,
		providers,
	]);
	const modelsForProvider = useMemo(
		() => visibleProviderModels[resolvedProvider] ?? [],
		[resolvedProvider, visibleProviderModels],
	);
	// Sectioned picker data: display names plus the Recommended/Free tiers the
	// SDK stamps onto cline/cline-pass models (ProviderModel.featured).
	const pickerDataForProvider = useCallback(
		(providerId: string): ModelPickerData => {
			const detailsById = new Map(
				(modelDetails[providerId] ?? []).map(
					(entry) => [entry.id, entry] as const,
				),
			);
			const models = (visibleProviderModels[providerId] ?? []).map(
				(id) => detailsById.get(id) ?? { id, name: id },
			);
			return includeCloudModels
				? {
						options: models.map((entry) => ({
							label: entry.name,
							value: entry.id,
						})),
					}
				: buildModelPickerData(providerId, models);
		},
		[includeCloudModels, modelDetails, visibleProviderModels],
	);
	useEffect(() => {
		const selected = modelDetails[normalizedProvider]?.find(
			(entry) => entry.id === model,
		);
		onModelSupportsImagesChange?.(
			selected?.inputModalities !== undefined
				? selected.inputModalities.includes("image")
				: (selected?.supportsVision ?? null),
		);
	}, [modelDetails, normalizedProvider, model, onModelSupportsImagesChange]);

	const modelPicker = useMemo(
		() => pickerDataForProvider(resolvedProvider),
		[pickerDataForProvider, resolvedProvider],
	);
	const pickerModelIds = useMemo(
		() => new Set(modelPicker.options.map((option) => option.value)),
		[modelPicker],
	);
	const resolvedModel = useMemo(() => {
		const rememberedModel =
			lastSelection.lastModelByProvider[resolvedProvider] ??
			(normalizeProviderId(rememberedLastProvider) === resolvedProvider
				? lastSelection.lastModelByProvider[rememberedLastProvider]
				: undefined);
		// Catalogs are discovery data, not validation: the bundled catalog can
		// omit live ClinePass models, and refreshes can return partial lists.
		// Keep the configured model for the current provider even if absent;
		// otherwise loading the catalog silently changes the session's model.
		if (
			model &&
			(normalizedProvider === resolvedProvider ||
				modelsForProvider.includes(model)) &&
			(!includeCloudModels ||
				!autoCorrectModel ||
				modelsForProvider.includes(model))
		) {
			return model;
		}
		// Missing remembered models may also be live-only. Models present in
		// the catalog but deliberately hidden from the offer still fall back.
		if (
			rememberedModel &&
			(pickerModelIds.has(rememberedModel) ||
				!modelsForProvider.includes(rememberedModel))
		) {
			return rememberedModel;
		}
		if (includeCloudModels) {
			const fallback =
				(localClinePass
					? visibleProviderModels["cline-pass"]?.[0]
					: undefined) ??
				(Object.values(visibleProviderModels).some((ids) =>
					ids.includes(CLINE_DEFAULT_MODEL_ID),
				)
					? CLINE_DEFAULT_MODEL_ID
					: undefined);
			if (fallback) return fallback;
		}
		return (
			modelsForProvider.find((id) => pickerModelIds.has(id)) ??
			modelsForProvider[0] ??
			""
		);
	}, [
		localClinePass,
		includeCloudModels,
		autoCorrectModel,
		lastSelection.lastModelByProvider,
		model,
		modelsForProvider,
		normalizedProvider,
		pickerModelIds,
		rememberedLastProvider,
		resolvedProvider,
		visibleProviderModels,
	]);
	// The picker can intentionally hide catalog models (the ClinePass offer
	// is exactly its subscribed/free tiers), but the active model must stay
	// visible and selectable — e.g. a hydrated session configured with a
	// model outside the current offer or missing from the catalog. Surface it
	// under its own section so the selected value always exists in the list.
	const visibleModelPicker = useMemo((): ModelPickerData => {
		if (!resolvedModel || pickerModelIds.has(resolvedModel)) {
			return modelPicker;
		}
		const detail = (modelDetails[resolvedProvider] ?? []).find(
			(entry) => entry.id === resolvedModel,
		);
		const hasSections = (modelPicker.sections?.length ?? 0) > 0;
		return {
			options: [
				...modelPicker.options,
				{
					label: detail?.name?.trim() || resolvedModel,
					...(hasSections ? { section: "current" } : {}),
					value: resolvedModel,
				},
			],
			...(hasSections
				? {
						sections: [
							...(modelPicker.sections ?? []),
							{ id: "current", label: "Current model" },
						],
					}
				: {}),
		};
	}, [
		modelDetails,
		modelPicker,
		pickerModelIds,
		resolvedModel,
		resolvedProvider,
	]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: catalogRevision is a reload signal.
	useEffect(() => {
		let cancelled = false;
		setReasoningCapabilitySource("loading");

		async function loadCatalogAndActiveModels() {
			try {
				const payload = await loadProviderModelCatalog(
					includeCloudModels ? { includeCloudModels: true } : undefined,
				);
				if (cancelled) {
					return;
				}
				setProviderModels(payload.providerModels);
				setProviderReasoningModels(payload.providerReasoningModels);
				setProviderNames((current) => ({
					...current,
					...(payload.providerNames ?? {}),
				}));
				setModelDetails((current) => ({
					...current,
					...(payload.providerModelDetails ?? {}),
				}));
				setReasoningCapabilitySource("catalog");
				setEnabledProviderIds((current) => {
					const nextProviderIds = new Set(payload.enabledProviderIds);
					if (
						normalizedProvider &&
						(!includeCloudModels || !autoCorrectModel)
					) {
						nextProviderIds.add(normalizedProvider);
					}
					for (const providerId of current) {
						if (!includeCloudModels && providerId in payload.providerModels) {
							nextProviderIds.add(providerId);
						}
					}
					return Array.from(nextProviderIds);
				});
			} catch {
				if (!cancelled) setReasoningCapabilitySource("fallback");
			}

			if (includeCloudModels || !normalizedProvider || cancelled) {
				return;
			}
			try {
				const models = await loadProviderModels(normalizedProvider);
				if (cancelled || models.length === 0) {
					return;
				}
				applyProviderModels(normalizedProvider, models);
				setReasoningCapabilitySource("catalog");
			} catch {
				// Keep the catalog values when provider-specific loading fails.
			}
		}

		void loadCatalogAndActiveModels();
		return () => {
			cancelled = true;
		};
	}, [
		applyProviderModels,
		autoCorrectModel,
		catalogRevision,
		includeCloudModels,
		normalizedProvider,
	]);

	useEffect(() => {
		return subscribeToProviderModels((providerId, models) => {
			const normalizedId = normalizeProviderId(providerId);
			if (includeCloudModels) return;
			applyProviderModels(normalizedId, models);
		});
	}, [applyProviderModels, includeCloudModels]);

	// The remembered selection (what new sessions default to) is only written
	// from the explicit picker handlers below. Mirroring every provider/model
	// prop change here would also capture passive changes — most notably
	// opening an existing session, whose config drives these props — silently
	// replacing the user's chosen default with whatever model that session
	// happened to use. It also skips automatic Cloud fallbacks, so the Cloud
	// default keeps following the local model and ClinePass subscription.
	const rememberSelection = useCallback(
		(providerId: string, modelId: string | undefined) => {
			if (includeCloudModels && syncSelection) {
				if (!modelId) return;
				try {
					writeModelSelectionStorageToWindow(
						{ lastProvider: "cline", lastModelByProvider: { cline: modelId } },
						"cloud",
					);
				} catch {
					// Ignore localStorage persistence failures.
				}
				return;
			}
			const normalizedId = normalizeProviderId(providerId);
			if (!normalizedId) {
				return;
			}
			setLastSelection((prev) => {
				if (
					prev.lastProvider === normalizedId &&
					(!modelId || prev.lastModelByProvider[normalizedId] === modelId)
				) {
					return prev;
				}
				return {
					lastProvider: normalizedId,
					lastModelByProvider: modelId
						? {
								...prev.lastModelByProvider,
								[normalizedId]: modelId,
							}
						: prev.lastModelByProvider,
				};
			});
		},
		[includeCloudModels, syncSelection],
	);

	useEffect(() => {
		if (includeCloudModels || !syncSelection) return;
		try {
			writeModelSelectionStorageToWindow(lastSelection);
		} catch {
			// Ignore localStorage persistence failures.
		}
	}, [includeCloudModels, lastSelection, syncSelection]);

	// A selection made mid-turn waits for the turn to end.
	const [pendingSelection, setPendingSelection] =
		useState<ModelSelectionChangedDetail | null>(null);
	useEffect(() => {
		if (includeCloudModels || !syncSelection) {
			setPendingSelection(null);
			return;
		}
		const handleSelectionChanged = (event: Event) => {
			setPendingSelection(
				(event as CustomEvent<ModelSelectionChangedDetail>).detail,
			);
			setLastSelection(readModelSelectionStorageFromWindow());
		};
		window.addEventListener(
			MODEL_SELECTION_CHANGED_EVENT,
			handleSelectionChanged,
		);
		return () =>
			window.removeEventListener(
				MODEL_SELECTION_CHANGED_EVENT,
				handleSelectionChanged,
			);
	}, [includeCloudModels, syncSelection]);
	useEffect(() => {
		if (!syncSelection || isBusy || !pendingSelection) return;
		setPendingSelection(null);
		onProviderChange(pendingSelection.providerId);
		onModelChange(pendingSelection.modelId);
	}, [
		isBusy,
		pendingSelection,
		onModelChange,
		onProviderChange,
		syncSelection,
	]);

	useEffect(() => {
		if (providers.length === 0) {
			return;
		}
		if (isBusy) {
			return;
		}
		if (
			!includeCloudModels &&
			resolvedProvider &&
			resolvedProvider !== normalizedProvider
		) {
			onProviderChange(resolvedProvider);
		}
		if (autoCorrectModel && resolvedModel && resolvedModel !== model) {
			onModelChange(resolvedModel);
		}
	}, [
		autoCorrectModel,
		includeCloudModels,
		isBusy,
		model,
		onModelChange,
		onProviderChange,
		normalizedProvider,
		providers,
		resolvedModel,
		resolvedProvider,
	]);

	useEffect(() => {
		if (reasoningCapabilitySource === "loading") {
			return;
		}
		if (
			reasoningCapabilitySource === "fallback" &&
			!(FALLBACK_PROVIDER_MODELS[normalizedProvider] ?? []).includes(model)
		) {
			onModelSupportsReasoningChange?.(null);
			return;
		}
		onModelSupportsReasoningChange?.(
			hasReasoningCapability(
				providerReasoningModels,
				normalizedProvider,
				model,
			),
		);
	}, [
		model,
		onModelSupportsReasoningChange,
		normalizedProvider,
		providerReasoningModels,
		reasoningCapabilitySource,
	]);

	const handleProviderSelect = useCallback(
		(value: string) => {
			if (value === ADD_PROVIDER_OPTION_VALUE) {
				setMobileOpen(false);
				onOpenModelSettings?.();
				return;
			}
			if (!includeCloudModels) onProviderChange(value);
			const rememberedModel = lastSelection.lastModelByProvider[value];
			const providerModelIds = visibleProviderModels[value] ?? [];
			// Preserve live-only remembered models missing from the bundled
			// catalog. Only fall back when a known model is hidden by the offer.
			const providerOptionIds = new Set(
				pickerDataForProvider(value).options.map((option) => option.value),
			);
			const nextModel =
				rememberedModel &&
				(providerOptionIds.has(rememberedModel) ||
					!providerModelIds.includes(rememberedModel))
					? rememberedModel
					: (providerModelIds.find((id) => providerOptionIds.has(id)) ??
						providerModelIds[0]);
			rememberSelection(value, nextModel);
			if (nextModel && nextModel !== model) {
				onModelChange(nextModel);
			}
		},
		[
			includeCloudModels,
			lastSelection.lastModelByProvider,
			model,
			onModelChange,
			onOpenModelSettings,
			onProviderChange,
			pickerDataForProvider,
			rememberSelection,
			visibleProviderModels,
		],
	);
	const handleModelSelect = useCallback(
		(value: string) => {
			rememberSelection(resolvedProvider, value);
			onModelChange(value);
		},
		[onModelChange, rememberSelection, resolvedProvider],
	);
	// The picker only lists providers with saved settings, so it is also the
	// natural place to reach the rest of the catalog.
	const providerOptions = useMemo(
		() => [
			...providers.map((value) => ({
				label: providerNames[value]?.trim() || value,
				value,
			})),
			...(onOpenModelSettings
				? [
						{
							icon: <Plus className="size-3 shrink-0 text-muted-foreground" />,
							label: "Set up another provider",
							value: ADD_PROVIDER_OPTION_VALUE,
						},
					]
				: []),
		],
		[onOpenModelSettings, providerNames, providers],
	);
	const selectedModelLabel =
		visibleModelPicker.options.find((option) => option.value === resolvedModel)
			?.label ?? resolvedModel;
	const renderProviderSelect = (layoutClassName: string) => (
		<SearchCombobox
			ariaLabel="Provider"
			className={cn(layoutClassName, providers.length === 0 && "opacity-50!")}
			disabled={isBusy || providers.length === 0}
			emptyText="No providers found."
			onValueChange={handleProviderSelect}
			options={providerOptions}
			placeholder="Provider"
			placement={placement}
			searchPlaceholder="Search providers"
			value={resolvedProvider}
		/>
	);
	const renderModelSelect = (
		layoutClassName: string,
		closeMobileMenu = false,
	) => (
		<SearchCombobox
			ariaLabel="Model"
			className={cn(
				layoutClassName,
				visibleModelPicker.options.length === 0 && "opacity-50!",
			)}
			disabled={isBusy || visibleModelPicker.options.length === 0}
			emptyText="No models found."
			onOpen={refreshActiveProviderModels}
			onValueChange={(value) => {
				handleModelSelect(value);
				if (closeMobileMenu) setMobileOpen(false);
			}}
			options={visibleModelPicker.options}
			panelWidth="20rem"
			placeholder="Model"
			placement={placement}
			searchPlaceholder="Search models"
			sections={visibleModelPicker.sections}
			value={resolvedModel}
		/>
	);

	if (
		includeCloudModels &&
		reasoningCapabilitySource === "fallback" &&
		providers.length === 0
	) {
		return (
			<button
				className="text-xs text-destructive"
				onClick={refreshActiveProviderModels}
				type="button"
			>
				Could not load cloud models. Retry
			</button>
		);
	}
	return (
		<div
			className={cn(
				"relative min-w-0 text-sm group-data-[compact]/composer:shrink-0",
				className,
			)}
		>
			<button
				aria-expanded={mobileOpen}
				aria-haspopup="dialog"
				aria-label="Model and provider"
				className="hidden size-7 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 group-data-[compact]/composer:inline-flex"
				disabled={isBusy || providers.length === 0}
				onClick={() => setMobileOpen((current) => !current)}
				title={`${providerNames[resolvedProvider]?.trim() || resolvedProvider || "Provider"} / ${selectedModelLabel || "Model"}`}
				type="button"
			>
				<Cpu className="size-3.5" />
			</button>

			{mobileOpen ? (
				<>
					<button
						aria-label="Close model selector"
						className="fixed inset-0 z-40 hidden cursor-default opacity-0 group-data-[compact]/composer:block"
						onClick={() => setMobileOpen(false)}
						type="button"
					/>
					<div className="absolute bottom-full left-0 z-50 mb-2 hidden w-64 max-w-[calc(100vw-2rem)] space-y-3 rounded-lg border border-border bg-popover p-3 shadow-xl animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1 motion-reduce:animate-none group-data-[compact]/composer:block">
						<div className="space-y-1">
							<div className="text-xs font-medium text-muted-foreground">
								Provider
							</div>
							{renderProviderSelect(
								"w-full max-w-none justify-between text-sm",
							)}
						</div>
						<div className="space-y-1">
							<div className="text-xs font-medium text-muted-foreground">
								Model
							</div>
							{renderModelSelect(
								"w-full max-w-none justify-between text-sm",
								true,
							)}
						</div>
					</div>
				</>
			) : null}

			<div className="flex min-w-0 items-center gap-0.5 group-data-[compact]/composer:hidden">
				{/* Wide enough for the longest built-in provider names ("Cline
				    Usage-Billing", "OpenAI ChatGPT Subscription") untruncated. */}
				<div className="shrink-0">{renderProviderSelect("max-w-56")}</div>
				<div className="bg-border-2 h-4 w-[0.1rem] shrink-0" />
				{/* Uncapped so long model names show in full when the row has
				    room; the name truncates only once the row runs out of space. */}
				{renderModelSelect("max-w-full")}
			</div>
		</div>
	);
}

/** The chat composer's selector: it follows and updates the remembered chat model. */
export const ModelSelector = memo(function ModelSelector(
	props: ModelSelectorProps,
) {
	return <ModelSelectorBase {...props} syncSelection />;
});

/** A form's selector: it holds only the provider and model it is given. */
export const DraftModelSelector = memo(function DraftModelSelector(
	props: ModelSelectorProps,
) {
	return <ModelSelectorBase {...props} syncSelection={false} />;
});
