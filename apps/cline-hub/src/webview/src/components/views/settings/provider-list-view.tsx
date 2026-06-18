"use client";

import {
	ArrowLeft,
	ChevronRight,
	Copy,
	Eye,
	EyeOff,
	FileIcon,
	ImageIcon,
	Link as LinkIcon,
	Loader2,
	PlusCircle,
	RefreshCw,
	Search,
	Star,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import type {
	Provider,
	ProviderConfigField,
	ProviderConfigFieldPrimitive,
	ProviderSettingsUpdate,
} from "@/lib/provider-schema";
import { cn } from "@/lib/utils";

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
}: {
	providers: Provider[];
	onToggle: (id: string) => void;
	onConfigure: (id: string) => void;
	onAddProvider: () => void;
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

	return (
		<ScrollArea className="h-full">
			<div className="px-18 py-10 max-[1200px]:px-8 max-[720px]:px-4 max-[720px]:py-5">
				<div className="mb-8 flex max-w-[42rem] items-end justify-between gap-4 max-[720px]:items-start">
					<div>
						<h1 className="text-[32px] font-semibold leading-none tracking-normal text-foreground">
							Models
						</h1>
						<p className="mt-8 text-[15px] text-muted-foreground max-[720px]:mt-4">
							{providers.length} available &middot; {enabledProviderCount}{" "}
							selected
						</p>
					</div>
					<div className="flex items-center gap-2">
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

				{providerSearchOpen ? (
					<div className="mb-4 max-w-[42rem]">
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

				<div className="max-w-[42rem] overflow-hidden">
					{filteredProviders.length === 0 ? (
						<div className="border-b px-2 py-6 text-[15px] text-muted-foreground">
							No providers match "{providerSearch.trim()}".
						</div>
					) : null}
					{filteredProviders.map((prov) => (
						<div
							className="flex min-h-11 items-center gap-4 border-b px-2 py-2 transition-colors hover:bg-accent/30"
							key={prov.id}
						>
							<button
								className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								onClick={() => onConfigure(prov.id)}
								type="button"
							>
								<p className="min-w-0 flex-1 truncate text-[17px] font-semibold text-foreground">
									{prov.name}
								</p>
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
								className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
	modelsLoading = false,
	modelsError,
	onOAuthLogin,
	oauthLoginPending = false,
}: {
	provider: Provider;
	onBack: () => void;
	onUpdate: (updates: ProviderSettingsUpdate) => void;
	onLoadModels?: () => void;
	modelsLoading?: boolean;
	modelsError?: string | null;
	onOAuthLogin?: () => void;
	oauthLoginPending?: boolean;
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
	const copiedModelTimeoutRef = useRef<number | undefined>(undefined);

	const configFields = provider.configFields ?? [];
	const apiKeyValue = fieldValueToString(localConfigValues.apiKey);
	const modelList = provider.modelList ?? [];
	const modelSearch =
		modelSearchState?.providerId === provider.id ? modelSearchState.value : "";
	const copiedModelId =
		copiedModelState?.providerId === provider.id
			? copiedModelState.modelId
			: null;
	const modelSearchQuery = modelSearch.trim().toLowerCase();
	const filteredModelList = modelSearchQuery
		? modelList.filter(
				(model) =>
					model.name.toLowerCase().includes(modelSearchQuery) ||
					model.id.toLowerCase().includes(modelSearchQuery),
			)
		: modelList;

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

	return (
		<ScrollArea className="h-full">
			<div className="px-18 py-10 max-[1200px]:px-8 max-[720px]:px-4 max-[720px]:py-5">
				{/* Back + title */}
				<div className="mb-8 flex items-center gap-3">
					<Button
						aria-label="Back to providers"
						className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
						onClick={onBack}
						variant="ghost"
					>
						<ArrowLeft className="h-4 w-4" />
					</Button>
					<h1 className="text-[32px] font-semibold leading-none tracking-normal text-foreground">
						{provider.name}
					</h1>
				</div>

				{configFields.length > 0 ? (
					<section className="mb-8 max-w-[86rem]">
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
											<h3 className="text-[17px] font-semibold text-foreground">
												{field.label}
											</h3>
											{field.description ? (
												<p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">
													{field.description}
												</p>
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
															className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
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
															className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
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
				<section className="max-w-[46rem] overflow-hidden rounded-lg border">
					<div className="flex h-12 items-center justify-between bg-muted/40 px-4">
						<h2 className="text-[17px] font-medium text-muted-foreground">
							Models
						</h2>
						<div className="flex items-center gap-1">
							<Search className="size-4 text-muted-foreground" />
							<Button
								aria-label="Refresh models"
								className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
								disabled={modelsLoading}
								onClick={onLoadModels}
								variant="ghost"
							>
								<RefreshCw
									className={cn("size-3", modelsLoading && "animate-spin")}
								/>
							</Button>
						</div>
					</div>

					{modelsError ? (
						<div className="rounded-lg border border-border px-4 py-8 text-center">
							<p className="text-sm text-destructive">{modelsError}</p>
						</div>
					) : modelList.length > 0 ? (
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
											className="group flex min-h-16 items-center gap-3 border-b px-4 py-3 transition-colors hover:bg-accent/30"
											key={model.id}
										>
											<div className="min-w-0 flex-1 font-mono">
												<div className="flex min-w-0 items-center gap-1.5 px-1 text-sm text-foreground">
													<span className="truncate">{model.name}</span>
													{/* Capability icons */}
													{model.supportsAttachments && (
														<div title="File Support">
															<FileIcon className="h-3.5 w-3.5 text-muted-foreground" />
														</div>
													)}
													{model.supportsVision && (
														<div title="Image Support">
															<ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
														</div>
													)}
												</div>
												<button
													aria-label={`Copy model ID ${model.id}`}
													className="mt-1 flex max-w-full items-center gap-1.5 px-1 text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

											{/* Action icons */}
											<div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
												<Button
													aria-label={`Favorite ${model.name}`}
													className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
													variant="ghost"
												>
													<Star className="h-3.5 w-3.5" />
												</Button>
											</div>
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
