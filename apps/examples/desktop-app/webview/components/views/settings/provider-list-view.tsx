"use client";

import {
	ArrowLeft,
	Brain,
	ChevronDown,
	ChevronRight,
	Copy,
	ExternalLink,
	Eye,
	EyeOff,
	FileIcon,
	Globe,
	ImageIcon,
	KeyRound,
	Link as LinkIcon,
	Loader2,
	Mic,
	MonitorSmartphone,
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
import {
	getProviderAuthKind,
	isProviderConnected,
	type ProviderAuthKind,
} from "@/lib/provider-connection";
import { getProviderApiKeyUrl } from "@/lib/provider-key-urls";
import {
	loadProviderModels,
	supportsAudio,
} from "@/lib/provider-model-catalog";
import type {
	Provider,
	ProviderConfigField,
	ProviderConfigFieldPrimitive,
	ProviderModel,
	ProviderSettingsUpdate,
} from "@/lib/provider-schema";
import { cn } from "@/lib/utils";

// Inputs nested inside a composed bordered box (icon + input + buttons in
// one rounded frame) must strip the Input component's own chrome — border,
// dark-mode bg tint, shadow, focus ring — or the inner field reads as a
// mismatched second box inside the frame.
const EMBEDDED_INPUT_CLASS =
	"h-7 flex-1 border-0 bg-transparent px-0 text-sm shadow-none outline-none placeholder:text-muted-foreground dark:bg-transparent focus-visible:ring-0";

const FAVORITE_MODELS_STORAGE_KEY = "cline.favorite-provider-models.v1";

// Providers whose model lists carry recommended-feed tiers (see the SDK's
// applyClineFeaturedModels). Only these are worth a per-card list fetch.
const FEATURED_PROVIDER_IDS = new Set(["cline", "cline-pass"]);

/** Tier + feed tags rendered as small pills next to the model name. */
function featuredBadges(model: ProviderModel): string[] {
	const featured = model.featured;
	if (!featured) {
		return [];
	}
	const badges: string[] = [];
	if (featured.tier === "recommended") {
		badges.push("Recommended");
	} else if (featured.tier === "free") {
		badges.push("Free");
	}
	for (const tag of featured.tags) {
		if (!badges.some((badge) => badge.toLowerCase() === tag.toLowerCase())) {
			badges.push(tag);
		}
	}
	return badges;
}

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
// Shared bits
// -----------------------------------------------------------

const AUTH_KIND_LABEL: Record<ProviderAuthKind, string> = {
	oauth: "Sign in",
	local: "Local CLI",
	"api-key": "API key",
};

function AuthKindHint({ kind }: { kind: ProviderAuthKind }) {
	const Icon =
		kind === "oauth" ? Globe : kind === "local" ? MonitorSmartphone : KeyRound;
	return (
		<span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
			<Icon aria-hidden="true" className="size-3" />
			{AUTH_KIND_LABEL[kind]}
		</span>
	);
}

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

// -----------------------------------------------------------
// Provider LIST content
// -----------------------------------------------------------

function ProviderRow({
	provider,
	onConfigure,
	selected,
}: {
	provider: Provider;
	onConfigure: (id: string) => void;
	selected: boolean;
}) {
	const connected = isProviderConnected(provider);
	const authKind = getProviderAuthKind(provider);
	return (
		<button
			className={cn(
				"flex min-h-12 w-full items-center gap-3 border-b px-2 py-2 text-left hover:bg-surface-hover-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
				selected && "bg-surface-hover",
			)}
			onClick={() => onConfigure(provider.id)}
			type="button"
		>
			<p className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">
				{provider.name}
			</p>
			{connected ? (
				<span className="shrink-0 text-xs font-medium text-muted-foreground">
					Configured
				</span>
			) : (
				<AuthKindHint kind={authKind} />
			)}
			<ChevronRight className="size-4 shrink-0 text-muted-foreground" />
		</button>
	);
}

function ProviderSectionHeading({
	title,
	description,
}: {
	title: string;
	description?: string;
}) {
	return (
		<div className="mb-2 mt-8 first:mt-0">
			<h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
				{title}
			</h2>
			{description ? (
				<p className="mt-1 text-sm text-muted-foreground">{description}</p>
			) : null}
		</div>
	);
}

export function ProviderListContent({
	providers,
	onConfigure,
	onAddProvider,
	selectedProviderId,
	variant = "page",
}: {
	providers: Provider[];
	onConfigure: (id: string) => void;
	onAddProvider: () => void;
	selectedProviderId?: string | null;
	variant?: "page" | "panel";
}) {
	const [providerSearch, setProviderSearch] = useState("");
	const isPanel = variant === "panel";

	const providerSearchQuery = providerSearch.trim().toLowerCase();
	const filteredProviders = providerSearchQuery
		? providers.filter(
				(provider) =>
					provider.name.toLowerCase().includes(providerSearchQuery) ||
					provider.id.toLowerCase().includes(providerSearchQuery),
			)
		: providers;

	const connectedProviders = filteredProviders.filter(isProviderConnected);
	const availableProviders = filteredProviders.filter(
		(provider) => !isProviderConnected(provider),
	);
	// The catalog arrives sorted by popular rank, then name; "popular" entries
	// surface first so the common providers don't drown in the long tail.
	const popularProviders = availableProviders.filter((provider) =>
		provider.capabilities?.includes("popular"),
	);
	const otherProviders = availableProviders.filter(
		(provider) => !provider.capabilities?.includes("popular"),
	);
	const connectedCount = providers.filter(isProviderConnected).length;

	const renderRows = (entries: Provider[]) => (
		<div className="overflow-hidden border-t">
			{entries.map((provider) => (
				<ProviderRow
					key={provider.id}
					onConfigure={onConfigure}
					provider={provider}
					selected={selectedProviderId === provider.id}
				/>
			))}
		</div>
	);

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
						"mb-6 flex items-start justify-between gap-6 max-[860px]:flex-col max-[860px]:items-stretch",
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
							{connectedCount === 0
								? "Connect a provider to start using models."
								: `${connectedCount} configured · ${providers.length} available`}
						</p>
					</div>
					<Button
						className="h-8 shrink-0 rounded-md bg-foreground px-3 text-sm text-background hover:bg-foreground/90 max-[860px]:self-start"
						onClick={onAddProvider}
						type="button"
					>
						<PlusCircle className="size-4" />
						Add provider
					</Button>
				</div>

				<div className={cn("mb-6", isPanel ? "max-w-none" : "max-w-2xl")}>
					<div className="flex h-9 items-center gap-2 rounded border bg-background px-3">
						<Search className="size-4 shrink-0 text-muted-foreground" />
						<Input
							aria-label="Search model providers"
							className={EMBEDDED_INPUT_CLASS}
							onChange={(event) => setProviderSearch(event.target.value)}
							placeholder="Search providers"
							value={providerSearch}
						/>
						{providerSearch ? (
							<button
								aria-label="Clear provider search"
								className="grid size-5 place-items-center rounded text-muted-foreground hover:text-foreground"
								onClick={() => setProviderSearch("")}
								type="button"
							>
								<X className="size-3.5" />
							</button>
						) : null}
					</div>
				</div>

				<div className={cn(isPanel ? "max-w-none" : "max-w-2xl")}>
					{filteredProviders.length === 0 ? (
						<div className="border-y px-2 py-6 text-base text-muted-foreground">
							No providers match "{providerSearch.trim()}".
						</div>
					) : null}

					{connectedProviders.length > 0 ? (
						<>
							<ProviderSectionHeading title="Configured" />
							{renderRows(connectedProviders)}
						</>
					) : null}

					{popularProviders.length > 0 ? (
						<>
							<ProviderSectionHeading
								description={
									connectedProviders.length === 0 && !providerSearchQuery
										? "Sign in or add an API key to connect."
										: undefined
								}
								title="Popular"
							/>
							{renderRows(popularProviders)}
						</>
					) : null}

					{otherProviders.length > 0 ? (
						<>
							<ProviderSectionHeading title="All providers" />
							{renderRows(otherProviders)}
						</>
					) : null}
				</div>
			</div>
		</ScrollArea>
	);
}

// -----------------------------------------------------------
// Provider DETAIL content
// -----------------------------------------------------------

function ConfigFieldRow({
	field,
	value,
	provider,
	shown,
	onToggleShown,
	onDraftChange,
	onCommit,
}: {
	field: ProviderConfigField;
	value: ProviderConfigFieldPrimitive | undefined;
	provider: Provider;
	shown: boolean;
	onToggleShown: () => void;
	onDraftChange: (value: string) => void;
	onCommit: (value: string | boolean) => void;
}) {
	const valueText = fieldValueToString(value);
	const isSecret = field.type === "password" || field.secret;
	const providerKeyUrl = getProviderApiKeyUrl(provider);
	return (
		<div className="grid min-h-18 grid-cols-[minmax(12rem,0.55fr)_minmax(16rem,0.45fr)] items-center gap-6 border-b py-4 max-[900px]:grid-cols-1 max-[900px]:gap-3">
			<header>
				<h3 className="text-lg font-semibold text-foreground">{field.label}</h3>
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
						{provider.docLabel || `Get a ${provider.name} API key`}
						<ExternalLink className="size-3.5" />
					</button>
				) : null}
			</header>
			{field.type === "boolean" ? (
				<div className="flex items-center justify-end">
					<span className="text-sm text-muted-foreground">{field.label}</span>
					<Switch
						checked={Boolean(value)}
						onCheckedChange={(checked) => onCommit(checked)}
					/>
				</div>
			) : field.type === "select" ? (
				<select
					className="h-9 w-full rounded border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
					onChange={(event) => onCommit(event.target.value)}
					value={valueText}
				>
					<option value="">Not set</option>
					{field.options?.map((option) => (
						<option key={String(option.value)} value={String(option.value)}>
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
						className={EMBEDDED_INPUT_CLASS}
						onBlur={() => onCommit(valueText)}
						onChange={(event) => onDraftChange(event.target.value)}
						placeholder={field.placeholder}
						spellCheck={false}
						type={
							isSecret && !shown
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
								aria-label={shown ? "Hide secret" : "Show secret"}
								className="rounded-md p-1 text-muted-foreground hover:text-foreground "
								onClick={onToggleShown}
								variant="ghost"
							>
								{shown ? (
									<EyeOff className="h-4 w-4" />
								) : (
									<Eye className="h-4 w-4" />
								)}
							</Button>
							<Button
								aria-label={`Copy ${field.label}`}
								className="rounded-md p-1 text-muted-foreground hover:text-foreground "
								onClick={() => navigator.clipboard.writeText(valueText)}
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
	onConnect,
	onDisconnect,
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
	onConnect?: () => void;
	onDisconnect?: () => void;
	variant?: "page" | "panel";
}) {
	const [shownSecrets, setShownSecrets] = useState<Record<string, boolean>>({});
	const [localConfigValues, setLocalConfigValues] = useState<
		Record<string, ProviderConfigFieldPrimitive>
	>(() => getInitialConfigValues(provider));
	const [manualKeyExpanded, setManualKeyExpanded] = useState(false);
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

	const authKind = getProviderAuthKind(provider);
	const connected = isProviderConnected(provider);
	const configFields = provider.configFields ?? [];
	const apiKeyField = configFields.find((field) => field.path === "apiKey");
	const apiKeyValue = fieldValueToString(localConfigValues.apiKey);
	// The catalog's modelList is fetched without the recommended-feed overlay
	// (the catalog must not block on the feed); featured providers refresh
	// their list here so tier badges and live entries can render. The result
	// is scoped to the provider AND the modelList revision it was fetched
	// for: an unscoped copy kept shadowing the next provider's models after
	// a switch (even when its own request failed) and masked membership
	// updates — adding a model would then submit the stale list as the
	// complete configuration and drop earlier additions.
	const [featuredModelList, setFeaturedModelList] = useState<{
		providerId: string;
		baseModelList: Provider["modelList"];
		models: ProviderModel[];
	} | null>(null);
	useEffect(() => {
		if (!FEATURED_PROVIDER_IDS.has(provider.id)) {
			return;
		}
		let cancelled = false;
		loadProviderModels(provider.id)
			.then((models) => {
				if (!cancelled && models.length > 0) {
					setFeaturedModelList({
						providerId: provider.id,
						baseModelList: provider.modelList,
						models,
					});
				}
			})
			.catch(() => {
				// Keep the catalog snapshot when the refresh fails.
			});
		return () => {
			cancelled = true;
		};
	}, [provider.id, provider.modelList]);
	const modelList =
		featuredModelList &&
		featuredModelList.providerId === provider.id &&
		featuredModelList.baseModelList === provider.modelList
			? featuredModelList.models
			: (provider.modelList ?? []);
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

	const handleDisconnect = () => {
		// The persisted entry is being removed; clear the local drafts so
		// stale secrets don't linger in the inputs.
		setShownSecrets({});
		setManualKeyExpanded(false);
		setLocalConfigValues(
			getInitialConfigValues({
				...provider,
				apiKey: undefined,
				configValues: undefined,
			}),
		);
		onDisconnect?.();
	};

	const renderConfigFieldRow = (field: ProviderConfigField) => (
		<ConfigFieldRow
			field={field}
			key={field.path}
			onCommit={(value) => commitField(field, value)}
			onDraftChange={(value) =>
				setLocalConfigValues((current) => ({
					...current,
					[field.path]: value,
				}))
			}
			onToggleShown={() =>
				setShownSecrets((current) => ({
					...current,
					[field.path]: !(current[field.path] ?? false),
				}))
			}
			provider={provider}
			shown={shownSecrets[field.path] ?? false}
			value={localConfigValues[field.path]}
		/>
	);

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
		// Submit the union of the displayed and configured lists: the update
		// replaces the provider's complete model configuration, so basing it
		// on the displayed list alone could silently drop configured entries
		// whenever the two diverge.
		const baseIds = [
			...new Set([
				...modelList.map((model) => model.id),
				...(provider.modelList ?? []).map((model) => model.id),
			]),
		];
		if (!modelId || baseIds.includes(modelId)) {
			return;
		}
		onUpdateModels?.([...baseIds, modelId]);
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

	const oauthConnected = Boolean(provider.oauthAccessTokenPresent);

	const connectionSection =
		authKind === "oauth" ? (
			<section className={cn("mb-8", isPanel ? "max-w-none" : "max-w-344")}>
				{oauthConnected ? (
					<div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
						<div className="min-w-0">
							<p className="text-sm font-medium text-foreground">
								Signed in via browser
							</p>
							<p className="text-xs text-muted-foreground">
								This provider authenticates with your account — no API key
								needed.
							</p>
						</div>
						{onDisconnect ? (
							<Button
								className="shrink-0"
								onClick={handleDisconnect}
								size="sm"
								type="button"
								variant="outline"
							>
								Sign out
							</Button>
						) : null}
					</div>
				) : connected && apiKeyValue ? (
					<div className="flex flex-col">
						<div className="mb-2 flex items-center justify-between gap-4">
							<p className="text-sm text-muted-foreground">
								Configured with an API key.
							</p>
							{onDisconnect ? (
								<Button
									className="shrink-0"
									onClick={handleDisconnect}
									size="sm"
									type="button"
									variant="outline"
								>
									Disconnect
								</Button>
							) : null}
						</div>
						{apiKeyField ? renderConfigFieldRow(apiKeyField) : null}
					</div>
				) : (
					<div className="rounded-lg border px-4 py-4">
						<p className="text-sm font-medium text-foreground">
							Sign in to {provider.name}
						</p>
						<p className="mt-1 text-xs text-muted-foreground">
							Connects through your browser. No API key needed.
						</p>
						{onOAuthLogin ? (
							<Button
								className="mt-3 inline-flex items-center gap-2"
								disabled={oauthLoginPending}
								onClick={onOAuthLogin}
								type="button"
								variant="default"
							>
								{oauthLoginPending ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : null}
								<span>
									{oauthLoginPending
										? "Waiting for browser..."
										: "Sign in with browser"}
								</span>
							</Button>
						) : null}
						{apiKeyField ? (
							<div className="mt-3">
								<Button
									aria-expanded={manualKeyExpanded}
									className="-ml-2"
									onClick={() => setManualKeyExpanded((open) => !open)}
									size="sm"
									type="button"
									variant="ghost"
								>
									Use an API key instead
									<ChevronDown
										aria-hidden="true"
										className={cn(
											"size-3.5 transition-transform",
											manualKeyExpanded && "rotate-180",
										)}
									/>
								</Button>
								{manualKeyExpanded ? (
									<div className="mt-1">
										{renderConfigFieldRow(apiKeyField)}
									</div>
								) : null}
							</div>
						) : null}
					</div>
				)}
			</section>
		) : authKind === "local" ? (
			<section className={cn("mb-8", isPanel ? "max-w-none" : "max-w-344")}>
				<div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
					<div className="min-w-0">
						<p className="text-sm font-medium text-foreground">
							Uses your local CLI sign-in
						</p>
						<p className="text-xs text-muted-foreground">
							Credentials come from the provider's own CLI on this machine — no
							API key needed.
						</p>
					</div>
					{connected
						? onDisconnect && (
								<Button
									className="shrink-0"
									onClick={handleDisconnect}
									size="sm"
									type="button"
									variant="outline"
								>
									Disconnect
								</Button>
							)
						: onConnect && (
								<Button
									className="shrink-0"
									onClick={onConnect}
									size="sm"
									type="button"
								>
									Connect
								</Button>
							)}
				</div>
			</section>
		) : (
			<section className={cn("mb-8", isPanel ? "max-w-none" : "max-w-344")}>
				{configFields.length > 0 ? (
					<div className="flex flex-col">
						{configFields.map(renderConfigFieldRow)}
					</div>
				) : null}
				<div className="mt-4 flex items-center justify-between gap-4">
					{connected ? (
						<>
							<p className="text-xs text-muted-foreground">
								Changes to the fields above are saved automatically.
							</p>
							{onDisconnect ? (
								<Button
									className="shrink-0"
									onClick={handleDisconnect}
									size="sm"
									type="button"
									variant="outline"
								>
									Disconnect
								</Button>
							) : null}
						</>
					) : (
						<>
							<p className="text-xs text-muted-foreground">
								Saving an API key configures this provider automatically. Use
								Connect if it reads credentials from your environment or a local
								endpoint.
							</p>
							{onConnect ? (
								<Button
									className="shrink-0"
									onClick={onConnect}
									size="sm"
									type="button"
									variant="outline"
								>
									Connect
								</Button>
							) : null}
						</>
					)}
				</div>
			</section>
		);

	return (
		<ScrollArea className="h-full">
			<div
				className={cn(
					"py-10 max-[720px]:px-4 max-[720px]:py-5",
					isPanel ? "px-6" : "px-18 max-[1200px]:px-8",
				)}
			>
				{/* Back + title (the panel variant is always open, so no close button) */}
				<div className="mb-8 flex items-center gap-3">
					{isPanel ? null : (
						<Button
							aria-label="Back to providers"
							className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground "
							onClick={onBack}
							variant="ghost"
						>
							<ArrowLeft className="size-4" />
						</Button>
					)}
					<h1
						className={cn(
							"min-w-0 flex-1 truncate font-semibold leading-[1.15] text-foreground",
							isPanel ? "text-2xl" : "text-3xl",
						)}
					>
						{provider.name}
					</h1>
					<span className="inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
						{connected ? "Configured" : "Not configured"}
					</span>
				</div>

				{connectionSection}

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
							<div className="mx-4 mt-4 flex h-9 items-center gap-2 rounded border bg-background px-3">
								<Search className="size-4 shrink-0 text-muted-foreground" />
								<Input
									aria-label="Search models"
									className={EMBEDDED_INPUT_CLASS}
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
								<div className="border-t">
									{filteredModelList.map((model) => (
										<div
											className="group flex min-h-16 items-center gap-3 border-b px-4 py-3 hover:bg-surface-hover-lighter"
											key={model.id}
										>
											<div className="min-w-0 flex-1 font-mono">
												<div className="flex min-w-0 items-center gap-1.5 px-1 text-sm text-foreground">
													<span className="truncate">{model.name}</span>
													{featuredBadges(model).map((badge) => (
														<span
															className="inline-flex shrink-0 items-center rounded bg-surface-hover px-1 py-px font-sans text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground"
															key={badge}
														>
															{badge}
														</span>
													))}
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
												{model.description ? (
													<p className="mt-0.5 truncate px-1 font-sans text-xs text-muted-foreground">
														{model.description}
													</p>
												) : null}
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
