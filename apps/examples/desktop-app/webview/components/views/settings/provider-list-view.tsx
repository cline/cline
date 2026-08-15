"use client";

import {
	ArrowLeft,
	Brain,
	ChevronRight,
	Copy,
	ExternalLink,
	Eye,
	EyeOff,
	FileIcon,
	ImageIcon,
	Link as LinkIcon,
	Loader2,
	Mic,
	Plus,
	PlusCircle,
	RefreshCw,
	Search,
	Star,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { openExternalUrl } from "@/lib/desktop-client";
import { getProviderApiKeyUrl } from "@/lib/provider-key-urls";
import {
	isDedicatedTranscriptionModel,
	supportsAudio,
} from "@/lib/provider-model-catalog";
import type {
	Provider,
	ProviderConfigField,
	ProviderConfigFieldPrimitive,
	ProviderSettingsUpdate,
	VoiceInputSelection,
} from "@/lib/provider-schema";
import { cn } from "@/lib/utils";

const FAVORITE_MODELS_STORAGE_KEY = "cline.favorite-provider-models.v1";

function readFavoriteModels(): Record<string, string[]> {
	if (typeof window === "undefined") return {};
	try {
		const value = JSON.parse(
			window.localStorage.getItem(FAVORITE_MODELS_STORAGE_KEY) ?? "{}",
		);
		if (!value || typeof value !== "object" || Array.isArray(value)) return {};
		return Object.fromEntries(
			Object.entries(value).filter(
				(entry): entry is [string, string[]] =>
					typeof entry[0] === "string" &&
					Array.isArray(entry[1]) &&
					entry[1].every((modelId) => typeof modelId === "string"),
			),
		);
	} catch {
		return {};
	}
}

function writeFavoriteModels(value: Record<string, string[]>): void {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(
		FAVORITE_MODELS_STORAGE_KEY,
		JSON.stringify(value),
	);
}

// -----------------------------------------------------------
// Provider LIST content (the grid of all providers)
// -----------------------------------------------------------

function getInitialConfigValues(
	provider: Provider,
): Record<string, ProviderConfigFieldPrimitive> {
	const values: Record<string, ProviderConfigFieldPrimitive> = {
		...(provider.configValues ?? {}),
	};
	if (provider.apiKey !== undefined && values.apiKey === undefined) {
		values.apiKey = provider.apiKey;
	}
	if (provider.baseUrl !== undefined && values.baseUrl === undefined) {
		values.baseUrl = provider.baseUrl;
	}
	for (const field of provider.configFields ?? []) {
		if (values[field.path] === undefined && field.defaultValue !== undefined) {
			values[field.path] = field.defaultValue;
		}
	}
	return values;
}

function fieldValueToString(value: ProviderConfigFieldPrimitive | undefined) {
	if (value === undefined || value === null) return "";
	return String(value);
}

function coerceFieldValue(
	field: ProviderConfigField,
	value: string | boolean,
): ProviderConfigFieldPrimitive {
	if (field.type === "boolean") {
		return Boolean(value);
	}
	if (typeof value === "boolean") {
		return value;
	}
	if (field.type === "select") {
		const option = field.options?.find((item) => String(item.value) === value);
		if (option) {
			return option.value;
		}
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return null;
	}
	if (field.type === "number") {
		const parsed = Number(trimmed);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return trimmed;
}

export function ProviderListContent({
	providers,
	onToggle,
	onConfigure,
	onAddProvider,
	onVoiceInputChange,
	selectedProviderId,
	variant = "page",
	voiceInput,
	voiceInputSaving = false,
}: {
	providers: Provider[];
	onToggle: (id: string) => void;
	onConfigure: (id: string) => void;
	onAddProvider: () => void;
	onVoiceInputChange: (selection: VoiceInputSelection | undefined) => void;
	selectedProviderId?: string | null;
	variant?: "page" | "panel";
	voiceInput?: VoiceInputSelection;
	voiceInputSaving?: boolean;
}) {
	const [providerSearchOpen, setProviderSearchOpen] = useState(false);
	const [providerSearch, setProviderSearch] = useState("");
	const enabledProviderCount = providers.filter(
		(provider) => provider.enabled,
	).length;
	const providerSearchQuery = providerSearch.trim().toLowerCase();
	const filteredProviders = providerSearchQuery
		? providers.filter((provider) =>
				provider.name.toLowerCase().includes(providerSearchQuery),
			)
		: providers;
	const isPanel = variant === "panel";
	const voiceProviders = providers
		.filter((provider) => provider.enabled)
		.map((provider) => ({
			provider,
			models: (provider.modelList ?? []).filter(isDedicatedTranscriptionModel),
		}))
		.filter((entry) => entry.models.length > 0);
	const selectedVoiceProvider = voiceProviders.find(
		(entry) => entry.provider.id === voiceInput?.providerId,
	);
	const selectedVoiceModels = selectedVoiceProvider?.models ?? [];

	return (
		<ScrollArea className="h-full">
			<div
				className={cn(
					"py-10 max-[720px]:px-4 max-[720px]:py-5",
					isPanel ? "px-8" : "px-18 max-[1200px]:px-8",
				)}
			>
				<div
					className={cn(
						"mb-8 flex items-start justify-between gap-6 max-[860px]:flex-col max-[860px]:items-stretch",
						isPanel ? "max-w-none" : "max-w-2xl",
					)}
				>
					<div className="min-w-0">
						<h1
							className={cn(
								"truncate font-semibold leading-[1.15] text-foreground",
								isPanel ? "text-2xl" : "text-3xl",
							)}
						>
							Model Providers
						</h1>
						<p className="mt-3 text-base leading-6 text-muted-foreground">
							{providers.length} available &middot; {enabledProviderCount}{" "}
							enabled
						</p>
					</div>
					<div className="flex shrink-0 items-center gap-2 max-[860px]:justify-start">
						<Button
							aria-label="Search providers"
							className="size-8 rounded-md"
							onClick={() => setProviderSearchOpen((open) => !open)}
							size="icon-sm"
							type="button"
							variant={providerSearchOpen ? "default" : "secondary"}
						>
							<Search className="size-4" />
						</Button>
						<Button
							className="h-8 rounded-md bg-foreground px-3 text-sm text-background hover:bg-foreground/90"
							onClick={onAddProvider}
							type="button"
						>
							<PlusCircle className="size-4" />
							Add provider
						</Button>
					</div>
				</div>

				<div
					className={cn(
						"mb-7 border-y py-4",
						isPanel ? "max-w-none" : "max-w-[42rem]",
					)}
				>
					<div className="mb-3">
						<h2 className="text-[17px] font-semibold text-foreground">
							Voice input
						</h2>
						<p className="mt-1 text-sm leading-5 text-muted-foreground">
							Choose the configured audio-to-text model used by the microphone
							in chat. Streaming models show text live; other models transcribe
							after recording stops.
						</p>
					</div>
					<div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
						<label className="space-y-1.5 text-sm text-muted-foreground">
							<span>Provider</span>
							<select
								aria-label="Voice input provider"
								className="h-9 w-full rounded border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
								disabled={voiceInputSaving}
								onChange={(event) => {
									const providerId = event.target.value;
									if (!providerId) {
										onVoiceInputChange(undefined);
										return;
									}
									const entry = voiceProviders.find(
										(candidate) => candidate.provider.id === providerId,
									);
									const modelId = entry?.models[0]?.id;
									if (modelId) {
										onVoiceInputChange({ providerId, modelId });
									}
								}}
								value={selectedVoiceProvider?.provider.id ?? ""}
							>
								<option value="">Not configured</option>
								{voiceProviders.map(({ provider }) => (
									<option key={provider.id} value={provider.id}>
										{provider.name}
									</option>
								))}
							</select>
						</label>
						<label className="space-y-1.5 text-sm text-muted-foreground">
							<span>Model</span>
							<select
								aria-label="Voice input model"
								className="h-9 w-full rounded border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
								disabled={!selectedVoiceProvider || voiceInputSaving}
								onChange={(event) => {
									if (!selectedVoiceProvider || !event.target.value) return;
									onVoiceInputChange({
										providerId: selectedVoiceProvider.provider.id,
										modelId: event.target.value,
									});
								}}
								value={voiceInput?.modelId ?? ""}
							>
								{selectedVoiceModels.length === 0 ? (
									<option value="">Enable an audio provider first</option>
								) : null}
								{selectedVoiceModels.map((model) => (
									<option key={model.id} value={model.id}>
										{model.name}
										{model.operationModes?.includes("streaming")
											? " (Live)"
											: ""}
									</option>
								))}
							</select>
						</label>
					</div>
				</div>

				{providerSearchOpen ? (
					<div className={cn("mb-4", isPanel ? "max-w-none" : "max-w-2xl")}>
						<div className="flex h-9 items-center gap-2 rounded border bg-background px-3">
							<Search className="size-4 shrink-0 text-muted-foreground" />
							<Input
								aria-label="Search model providers"
								autoFocus
								className="h-7 border-0 bg-transparent px-0 text-sm"
								onChange={(event) => setProviderSearch(event.target.value)}
								placeholder="Search providers"
								value={providerSearch}
							/>
						</div>
					</div>
				) : null}

				<div
					className={cn(
						"overflow-hidden",
						isPanel ? "max-w-none" : "max-w-2xl",
					)}
				>
					{filteredProviders.length === 0 ? (
						<div className="border-b px-2 py-6 text-base text-muted-foreground">
							No providers match "{providerSearch.trim()}".
						</div>
					) : null}
					{filteredProviders.map((prov) => (
						<div
							className={cn(
								"flex min-h-11 items-center gap-4 border-b px-2 py-2 hover:bg-surface-hover-lighter",
								selectedProviderId === prov.id && "bg-surface-hover",
							)}
							key={prov.id}
						>
							<button
								className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								onClick={() => onConfigure(prov.id)}
								type="button"
							>
								<div className="flex min-w-0 flex-1 items-baseline gap-2">
									<p className="truncate text-lg font-semibold text-foreground">
										{prov.name}
									</p>
									<p className="shrink-0 truncate font-mono text-xs text-muted-foreground">
										{prov.id}
									</p>
								</div>
								<p className="shrink-0 text-[15px] text-muted-foreground">
									{prov.models === null
										? "Models load on demand"
										: `${prov.models} model${prov.models !== 1 ? "s" : ""}`}
								</p>
							</button>
							<Switch
								aria-label={`Toggle ${prov.name}`}
								checked={prov.enabled}
								onCheckedChange={() => onToggle(prov.id)}
							/>
							<button
								aria-label={`Configure ${prov.name}`}
								className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground  hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								onClick={() => onConfigure(prov.id)}
								type="button"
							>
								<ChevronRight className="size-4" />
							</button>
						</div>
					))}
				</div>
			</div>
		</ScrollArea>
	);
}

export function ProviderDetailContent({
	provider,
	onBack,
	onUpdate,
	onLoadModels,
	onUpdateModels,
	modelsLoading = false,
	modelsError,
	onOAuthLogin,
	oauthLoginPending = false,
	variant = "page",
}: {
	provider: Provider;
	onBack: () => void;
	onUpdate: (updates: ProviderSettingsUpdate) => void;
	onLoadModels?: () => void;
	onUpdateModels?: (models: string[]) => void;
	modelsLoading?: boolean;
	modelsError?: string | null;
	onOAuthLogin?: () => void;
	oauthLoginPending?: boolean;
	variant?: "page" | "panel";
}) {
	const [shownSecrets, setShownSecrets] = useState<Record<string, boolean>>({});
	const [localConfigValues, setLocalConfigValues] = useState<
		Record<string, ProviderConfigFieldPrimitive>
	>(() => getInitialConfigValues(provider));
	const [modelSearchState, setModelSearchState] = useState<{
		providerId: string;
		value: string;
	} | null>(null);
	const [copiedModelState, setCopiedModelState] = useState<{
		modelId: string;
		providerId: string;
	} | null>(null);
	const [addModelState, setAddModelState] = useState<{
		providerId: string;
		value: string;
	} | null>(null);
	const [favoriteModels, setFavoriteModels] = useState(readFavoriteModels);
	const copiedModelTimeoutRef = useRef<number | undefined>(undefined);

	const configFields = provider.configFields ?? [];
	const apiKeyValue = fieldValueToString(localConfigValues.apiKey);
	const providerKeyUrl = getProviderApiKeyUrl(provider);
	const modelList = provider.modelList ?? [];
	const modelSearch =
		modelSearchState?.providerId === provider.id ? modelSearchState.value : "";
	const copiedModelId =
		copiedModelState?.providerId === provider.id
			? copiedModelState.modelId
			: null;
	const isAddingModel = addModelState?.providerId === provider.id;
	const newModelId = isAddingModel ? addModelState.value : "";
	const modelSearchQuery = modelSearch.trim().toLowerCase();
	const matchingModelList = modelSearchQuery
		? modelList.filter(
				(model) =>
					model.name.toLowerCase().includes(modelSearchQuery) ||
					model.id.toLowerCase().includes(modelSearchQuery),
			)
		: modelList;
	const favoriteModelIds = new Set(favoriteModels[provider.id] ?? []);
	const filteredModelList = [...matchingModelList].sort(
		(a, b) =>
			Number(favoriteModelIds.has(b.id)) - Number(favoriteModelIds.has(a.id)),
	);
	const isPanel = variant === "panel";

	useEffect(
		() => () => {
			if (copiedModelTimeoutRef.current !== undefined) {
				window.clearTimeout(copiedModelTimeoutRef.current);
			}
		},
		[],
	);

	const commitField = (
		field: ProviderConfigField,
		rawValue: string | boolean,
	) => {
		const value = coerceFieldValue(field, rawValue);
		const nextConfigValues = {
			...localConfigValues,
			[field.path]: value,
		};
		setLocalConfigValues(nextConfigValues);

		const updates: ProviderSettingsUpdate = {
			configValues: { [field.path]: value },
		};
		if (field.path === "apiKey") {
			updates.apiKey = fieldValueToString(value);
		}
		if (field.path === "baseUrl") {
			updates.baseUrl = fieldValueToString(value);
		}
		onUpdate(updates);
	};

	const copyModelId = (modelId: string) => {
		if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
			return;
		}
		void navigator.clipboard.writeText(modelId).then(() => {
			setCopiedModelState({ modelId, providerId: provider.id });
			if (copiedModelTimeoutRef.current !== undefined) {
				window.clearTimeout(copiedModelTimeoutRef.current);
			}
			copiedModelTimeoutRef.current = window.setTimeout(
				() => setCopiedModelState(null),
				1600,
			);
		});
	};

	const addModel = () => {
		const modelId = newModelId.trim();
		if (!modelId || modelList.some((model) => model.id === modelId)) {
			return;
		}
		onUpdateModels?.([...modelList.map((model) => model.id), modelId]);
		setAddModelState(null);
	};

	const toggleFavoriteModel = (modelId: string) => {
		setFavoriteModels((current) => {
			const providerFavorites = new Set(current[provider.id] ?? []);
			if (providerFavorites.has(modelId)) providerFavorites.delete(modelId);
			else providerFavorites.add(modelId);
			const next = {
				...current,
				[provider.id]: Array.from(providerFavorites),
			};
			writeFavoriteModels(next);
			return next;
		});
	};

	return (
		<ScrollArea className="h-full">
			<div
				className={cn(
					"py-10 max-[720px]:px-4 max-[720px]:py-5",
					isPanel ? "px-6" : "px-18 max-[1200px]:px-8",
				)}
			>
				{/* Back + title */}
				<div className="mb-8 flex items-center gap-3">
					<Button
						aria-label={
							isPanel ? "Close provider details" : "Back to providers"
						}
						className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground "
						onClick={onBack}
						variant="ghost"
					>
						{isPanel ? (
							<X className="h-4 w-4" />
						) : (
							<ArrowLeft className="h-4 w-4" />
						)}
					</Button>
					<div className="flex min-w-0 items-baseline gap-2">
						<h1
							className={cn(
								"truncate font-semibold leading-[1.15] text-foreground",
								isPanel ? "text-2xl" : "text-3xl",
							)}
						>
							{provider.name}
						</h1>
						<p className="shrink-0 font-mono text-xs text-muted-foreground">
							{provider.id}
						</p>
					</div>
				</div>

				{configFields.length > 0 ? (
					<section className={cn("mb-8", isPanel ? "max-w-none" : "max-w-344")}>
						<div className="flex flex-col">
							{configFields.map((field) => {
								const value = localConfigValues[field.path];
								const valueText = fieldValueToString(value);
								const isSecret = field.type === "password" || field.secret;
								const isShown = shownSecrets[field.path] ?? false;
								return (
									<div
										className="grid min-h-18 grid-cols-[minmax(12rem,0.55fr)_minmax(16rem,0.45fr)] items-center gap-6 border-b py-4 max-[900px]:grid-cols-1 max-[900px]:gap-3"
										key={field.path}
									>
										<header>
											<h3 className="text-lg font-semibold text-foreground">
												{field.label}
											</h3>
											{field.description ? (
												<p className="mt-1 text-base leading-relaxed text-muted-foreground">
													{field.description}
												</p>
											) : null}
											{field.path === "apiKey" && providerKeyUrl ? (
												<button
													className="mt-1 inline-flex items-center gap-1 text-sm text-primary underline-offset-2 transition-colors hover:underline"
													onClick={() => void openExternalUrl(providerKeyUrl)}
													type="button"
												>
													{provider.docLabel ||
														`Get a ${provider.name} API key`}
													<ExternalLink className="size-3.5" />
												</button>
											) : null}
										</header>
										{field.type === "boolean" ? (
											<div className="flex items-center justify-end">
												<span className="text-sm text-muted-foreground">
													{field.label}
												</span>
												<Switch
													checked={Boolean(value)}
													onCheckedChange={(checked) =>
														commitField(field, checked)
													}
												/>
											</div>
										) : field.type === "select" ? (
											<select
												className="h-9 w-full rounded border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
												onChange={(event) =>
													commitField(field, event.target.value)
												}
												value={valueText}
											>
												<option value="">Not set</option>
												{field.options?.map((option) => (
													<option
														key={String(option.value)}
														value={String(option.value)}
													>
														{option.label}
													</option>
												))}
											</select>
										) : (
											<div className="flex h-9 items-center gap-2 rounded border border-border bg-background px-3">
												{field.type === "url" ? (
													<LinkIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
												) : null}
												<Input
													className="h-7 flex-1 border-0 bg-transparent px-0 text-sm text-foreground outline-none placeholder:text-muted-foreground"
													onBlur={() => commitField(field, valueText)}
													onChange={(event) =>
														setLocalConfigValues((current) => ({
															...current,
															[field.path]: event.target.value,
														}))
													}
													placeholder={field.placeholder}
													spellCheck={false}
													type={
														isSecret && !isShown
															? "password"
															: field.type === "number"
																? "number"
																: field.type === "url"
																	? "url"
																	: "text"
													}
													value={valueText}
												/>
												{isSecret ? (
													<>
														<Button
															aria-label={
																isShown ? "Hide secret" : "Show secret"
															}
															className="rounded-md p-1 text-muted-foreground hover:text-foreground "
															onClick={() =>
																setShownSecrets((current) => ({
																	...current,
																	[field.path]: !isShown,
																}))
															}
															variant="ghost"
														>
															{isShown ? (
																<EyeOff className="h-4 w-4" />
															) : (
																<Eye className="h-4 w-4" />
															)}
														</Button>
														<Button
															aria-label={`Copy ${field.label}`}
															className="rounded-md p-1 text-muted-foreground hover:text-foreground "
															onClick={() =>
																navigator.clipboard.writeText(valueText)
															}
															variant="ghost"
														>
															<Copy className="h-4 w-4" />
														</Button>
													</>
												) : null}
											</div>
										)}
									</div>
								);
							})}
						</div>
					</section>
				) : null}

				{!apiKeyValue && !provider.oauthAccessTokenPresent && onOAuthLogin ? (
					<div className="mb-8">
						<Button
							className="inline-flex items-center gap-2 w-full"
							disabled={oauthLoginPending}
							onClick={onOAuthLogin}
							variant="default"
						>
							{oauthLoginPending ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : null}
							<span>Login via Browser</span>
						</Button>
					</div>
				) : null}
				{provider.oauthAccessTokenPresent ? (
					<p className="mb-8 text-xs text-muted-foreground">
						OAuth is connected. Manual credentials remain available when this
						provider supports them.
					</p>
				) : null}

				{/* Models section */}
				<section
					className={cn(
						"overflow-hidden rounded-lg border",
						isPanel ? "max-w-none" : "max-w-184",
					)}
				>
					<div className="flex h-12 items-center justify-between bg-muted/40 px-4">
						<div className="flex items-center gap-1">
							<h2 className="mr-1 text-lg font-medium text-muted-foreground">
								Models
							</h2>
							<Button
								aria-label="Refresh models"
								className="size-4 rounded-none p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground"
								disabled={modelsLoading}
								onClick={onLoadModels}
								variant="ghost"
							>
								<RefreshCw
									className={cn("size-4", modelsLoading && "animate-spin")}
								/>
							</Button>
						</div>
						{onUpdateModels ? (
							<Button
								aria-label="Add model"
								className="size-4 rounded-none p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground"
								disabled={modelsLoading}
								onClick={() =>
									setAddModelState({ providerId: provider.id, value: "" })
								}
								variant="ghost"
							>
								<Plus className="size-4" />
							</Button>
						) : null}
					</div>
					{isAddingModel ? (
						<div className="flex items-center gap-2 border-t px-4 py-3">
							<Input
								aria-label="New model ID"
								autoFocus
								className="h-9 flex-1 font-mono"
								onChange={(event) =>
									setAddModelState({
										providerId: provider.id,
										value: event.target.value,
									})
								}
								onKeyDown={(event) => {
									if (event.key === "Enter") addModel();
									if (event.key === "Escape") setAddModelState(null);
								}}
								placeholder="Model ID"
								value={newModelId}
							/>
							<Button
								disabled={!newModelId.trim()}
								onClick={addModel}
								size="sm"
							>
								Add
							</Button>
							<Button
								onClick={() => setAddModelState(null)}
								size="sm"
								variant="ghost"
							>
								Cancel
							</Button>
						</div>
					) : null}

					{modelsError ? (
						<div className="border-t border-destructive/30 bg-destructive/5 px-4 py-2">
							<p className="text-sm text-destructive">{modelsError}</p>
						</div>
					) : null}
					{modelList.length > 0 ? (
						<div className="space-y-3">
							<div className="mx-4 mt-4 flex items-center gap-2 rounded border border-border bg-background px-3 py-2">
								<Search className="size-4 shrink-0 text-muted-foreground" />
								<Input
									aria-label="Search models"
									className="h-7 flex-1 border-0 text-sm text-foreground placeholder:text-muted-foreground"
									onChange={(event) =>
										setModelSearchState({
											providerId: provider.id,
											value: event.target.value,
										})
									}
									placeholder="Search models by name or ID"
									spellCheck={false}
									value={modelSearch}
								/>
							</div>
							{filteredModelList.length > 0 ? (
								<div className="max-h-125 overflow-y-scroll border-t">
									{filteredModelList.map((model) => (
										<div
											className="group flex min-h-16 items-center gap-3 border-b px-4 py-3 hover:bg-surface-hover-lighter"
											key={model.id}
										>
											<div className="min-w-0 flex-1 font-mono">
												<div className="flex min-w-0 items-center gap-1.5 px-1 text-sm text-foreground">
													<span className="truncate">{model.name}</span>
													{/* Capability icons */}
													{model.supportsAttachments && (
														<span
															aria-label="File support"
															role="img"
															title="File support"
														>
															<FileIcon
																aria-hidden="true"
																className="h-3.5 w-3.5 text-muted-foreground"
															/>
														</span>
													)}
													{model.supportsVision && (
														<span
															aria-label="Image support"
															role="img"
															title="Image support"
														>
															<ImageIcon
																aria-hidden="true"
																className="h-3.5 w-3.5 text-muted-foreground"
															/>
														</span>
													)}
													{supportsAudio(model) && (
														<span
															aria-label="Audio support"
															role="img"
															title="Audio support"
														>
															<Mic
																aria-hidden="true"
																className="h-3.5 w-3.5 text-muted-foreground"
															/>
														</span>
													)}
													{model.supportsReasoning && (
														<span
															aria-label="Reasoning support"
															role="img"
															title="Reasoning support"
														>
															<Brain
																aria-hidden="true"
																className="h-3.5 w-3.5 text-muted-foreground"
															/>
														</span>
													)}
												</div>
												<button
													aria-label={`Copy model ID ${model.id}`}
													className="mt-1 flex max-w-full items-center gap-1.5 px-1 text-left text-xs text-muted-foreground  hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
													onClick={() => copyModelId(model.id)}
													title="Copy model ID"
													type="button"
												>
													<span className="min-w-0 truncate">{model.id}</span>
													<Copy className="size-3 shrink-0" />
													{copiedModelId === model.id ? (
														<span className="shrink-0 text-foreground">
															Copied
														</span>
													) : null}
												</button>
											</div>

											<Button
												aria-label={
													favoriteModelIds.has(model.id)
														? `Unfavorite ${model.name}`
														: `Favorite ${model.name}`
												}
												className={cn(
													"ml-auto shrink-0 rounded-md p-1.5 transition-colors hover:bg-surface-hover hover:text-foreground",
													favoriteModelIds.has(model.id)
														? "text-amber-400"
														: "text-muted-foreground",
												)}
												onClick={() => toggleFavoriteModel(model.id)}
												variant="ghost"
											>
												<Star
													className={cn(
														"size-4",
														favoriteModelIds.has(model.id) && "fill-current",
													)}
												/>
											</Button>
										</div>
									))}
								</div>
							) : (
								<div className="rounded-lg border border-border px-4 py-8 text-center">
									<p className="text-sm text-muted-foreground">
										No models match "{modelSearch.trim()}".
									</p>
								</div>
							)}
						</div>
					) : (
						<div className="rounded-lg border border-border px-4 py-8 text-center">
							<p className="text-sm text-muted-foreground">
								{modelsLoading
									? "Loading models..."
									: "No models available. Click refresh to load models."}
							</p>
						</div>
					)}
				</section>
			</div>
		</ScrollArea>
	);
}
