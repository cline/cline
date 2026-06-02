"use client";

import { ChevronDown, ChevronRight, Moon, Sun, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { desktopClient } from "@/lib/desktop-client";
import type {
	Provider,
	ProviderCatalogResponse,
	ProviderModelsResponse,
	ProviderSettingsUpdate,
} from "@/lib/provider-schema";
import { cn } from "@/lib/utils";
import { AccountView } from "./account-view";
import { AddProviderContent, type AddProviderPayload } from "./add-provider";
import { ChannelsContent } from "./channels-view";
import { RulesView } from "./extensions-view";
import { McpServersContent } from "./mcp-view";
import {
	ProviderDetailContent,
	ProviderListContent,
} from "./provider-list-view";
import { RoutineSchedulesContent } from "./routine-view";
import { toSettingsPatch } from "./settings-patch";

// -----------------------------------------------------------
// Settings nav categories
// -----------------------------------------------------------

const navCategories = [
	"General",
	"Providers",
	"Customizations",
	"MCP",
	"Channels",
	"Schedules",
	"Account",
] as const;

export type SettingsSection = (typeof navCategories)[number];
type Theme = "dark" | "light";
type GlobalSettingsResponse = {
	telemetryOptOut: boolean;
};

const PROVIDER_CATALOG_CACHE_TTL_MS = 60_000;

let providerCatalogCache: {
	providers: Provider[];
	fetchedAt: number;
} | null = null;

// -----------------------------------------------------------
// Component
// -----------------------------------------------------------

export function SettingsView({
	initialSection = "General",
	onClose,
	onNavigateSection,
	onThemeChange,
	theme,
}: {
	initialSection?: SettingsSection;
	onClose: () => void;
	onNavigateSection?: (section: SettingsSection) => void;
	onThemeChange: (theme: Theme) => void;
	theme: Theme;
}) {
	const [activeNav, setActiveNav] = useState<SettingsSection>(initialSection);
	const [providersExpanded, setProvidersExpanded] = useState(true);
	const [providers, setProviders] = useState<Provider[]>(
		() => providerCatalogCache?.providers ?? [],
	);
	const [providersLoading, setProvidersLoading] = useState(
		() => !providerCatalogCache,
	);
	const [providerCatalogError, setProviderCatalogError] = useState<
		string | null
	>(null);
	const [modelsLoadingByProvider, setModelsLoadingByProvider] = useState<
		Record<string, boolean>
	>({});
	const [modelsErrorByProvider, setModelsErrorByProvider] = useState<
		Record<string, string | null>
	>({});
	const [oauthSigningProviderId, setOauthSigningProviderId] = useState<
		string | null
	>(null);
	const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
		null,
	);
	const [addingProvider, setAddingProvider] = useState(false);

	const setProvidersWithCache = useCallback(
		(next: Provider[] | ((prev: Provider[]) => Provider[])) => {
			setProviders((prev) => {
				const resolved =
					typeof next === "function"
						? (next as (prev: Provider[]) => Provider[])(prev)
						: next;
				providerCatalogCache = {
					providers: resolved,
					fetchedAt: Date.now(),
				};
				return resolved;
			});
		},
		[],
	);

	const loadProviderCatalog = useCallback(async () => {
		const now = Date.now();
		if (
			providerCatalogCache &&
			now - providerCatalogCache.fetchedAt < PROVIDER_CATALOG_CACHE_TTL_MS
		) {
			setProviders(providerCatalogCache.providers);
			setProvidersLoading(false);
			setProviderCatalogError(null);
			return;
		}

		setProvidersLoading(true);
		setProviderCatalogError(null);
		try {
			const payload = await desktopClient.invoke<ProviderCatalogResponse>(
				"list_provider_catalog",
			);
			setProvidersWithCache(payload.providers);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setProviderCatalogError(message);
			setProviders([]);
		} finally {
			setProvidersLoading(false);
		}
	}, [setProvidersWithCache]);

	useEffect(() => {
		const timeoutId = window.setTimeout(() => {
			void loadProviderCatalog();
		}, 0);
		return () => window.clearTimeout(timeoutId);
	}, [loadProviderCatalog]);

	const persistProviderSettings = useCallback(
		async (
			id: string,
			updates: {
				enabled?: boolean;
				apiKey?: string;
				baseUrl?: string;
				configValues?: ProviderSettingsUpdate["configValues"];
			},
		) => {
			try {
				await desktopClient.invoke("save_provider_settings", {
					provider: id,
					enabled: updates.enabled,
					api_key: updates.apiKey,
					base_url: updates.baseUrl,
					settings: updates.configValues
						? toSettingsPatch(updates.configValues)
						: undefined,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				window.alert(`Failed to save provider settings for ${id}: ${message}`);
			}
		},
		[],
	);

	const toggleProvider = useCallback(
		(id: string) => {
			setProvidersWithCache((prev) =>
				prev.map((p) => {
					if (p.id !== id) {
						return p;
					}
					const nextEnabled = !p.enabled;
					void persistProviderSettings(id, { enabled: nextEnabled });
					return { ...p, enabled: nextEnabled };
				}),
			);
		},
		[persistProviderSettings, setProvidersWithCache],
	);

	const updateProvider = useCallback(
		(id: string, updates: ProviderSettingsUpdate) => {
			setProvidersWithCache((prev) =>
				prev.map((p) =>
					p.id === id
						? {
								...p,
								...updates,
								configValues: updates.configValues
									? {
											...(p.configValues ?? {}),
											...updates.configValues,
										}
									: p.configValues,
							}
						: p,
				),
			);
			void persistProviderSettings(id, {
				apiKey: updates.apiKey,
				baseUrl: updates.baseUrl,
				configValues: updates.configValues,
			});
		},
		[persistProviderSettings, setProvidersWithCache],
	);

	const loadProviderModels = useCallback(
		async (id: string) => {
			setModelsLoadingByProvider((prev) => ({ ...prev, [id]: true }));
			setModelsErrorByProvider((prev) => ({ ...prev, [id]: null }));
			try {
				const payload = await desktopClient.invoke<ProviderModelsResponse>(
					"list_provider_models",
					{
						provider: id,
					},
				);
				setProvidersWithCache((prev) =>
					prev.map((provider) =>
						provider.id === id
							? {
									...provider,
									modelList: payload.models,
									models: payload.models.length,
								}
							: provider,
					),
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setModelsErrorByProvider((prev) => ({ ...prev, [id]: message }));
			} finally {
				setModelsLoadingByProvider((prev) => ({ ...prev, [id]: false }));
			}
		},
		[setProvidersWithCache],
	);

	const enabledProviders = providers.filter((p) => p.enabled);
	const selectedProvider = selectedProviderId
		? (providers.find((p) => p.id === selectedProviderId) ?? null)
		: null;

	const isOAuthProvider = (id: string) =>
		id === "cline" || id === "oca" || id === "openai-codex";

	const runOAuthProviderLogin = async (id: string) => {
		setOauthSigningProviderId(id);
		try {
			const result = await desktopClient.invoke<{
				provider: string;
				accessToken: string;
			}>("run_provider_oauth_login", {
				provider: id,
			});
			setProvidersWithCache((prev) =>
				prev.map((provider) =>
					provider.id === id
						? {
								...provider,
								enabled: true,
								oauthAccessTokenPresent: result.accessToken.trim().length > 0,
							}
						: provider,
				),
			);
			setSelectedProviderId(id);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			window.alert(`Failed to sign in to ${id}: ${message}`);
		} finally {
			setOauthSigningProviderId(null);
		}
	};

	const openProviderDetail = (id: string) => {
		setActiveNav("Providers");
		onNavigateSection?.("Providers");
		setSelectedProviderId(id);
	};

	useEffect(() => {
		if (!selectedProviderId) {
			return;
		}
		const selected = providers.find(
			(provider) => provider.id === selectedProviderId,
		);
		if (!selected || (selected.modelList?.length ?? 0) > 0) {
			return;
		}
		const timeoutId = window.setTimeout(() => {
			void loadProviderModels(selectedProviderId);
		}, 0);
		return () => window.clearTimeout(timeoutId);
	}, [loadProviderModels, providers, selectedProviderId]);

	const backToProviderList = () => {
		onNavigateSection?.("Providers");
		setSelectedProviderId(null);
		setAddingProvider(false);
	};

	const saveNewProvider = useCallback(
		async (payload: AddProviderPayload) => {
			await desktopClient.invoke("add_provider", {
				provider_id: payload.providerId,
				name: payload.name,
				base_url: payload.baseUrl,
				api_key: payload.apiKey,
				headers: payload.headers,
				timeout_ms: payload.timeoutMs,
				models: payload.models,
				default_model_id: payload.defaultModelId,
				models_source_url: payload.modelsSourceUrl,
				capabilities: payload.capabilities,
			});
			await loadProviderCatalog();
			setAddingProvider(false);
			setSelectedProviderId(payload.providerId);
		},
		[loadProviderCatalog],
	);

	const openAddProvider = () => {
		onNavigateSection?.("Providers");
		setSelectedProviderId(null);
		setAddingProvider(true);
	};

	const selectSection = (section: SettingsSection) => {
		setActiveNav(section);
		onNavigateSection?.(section);
		setSelectedProviderId(null);
		setAddingProvider(false);
	};

	return (
		<div className="flex h-full flex-col overflow-hidden bg-background">
			{/* Header bar */}
			<div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-3">
				<h1 className="text-lg font-semibold text-foreground">Settings</h1>
				<Button
					aria-label="Close settings"
					className="justify-start"
					onClick={onClose}
					variant="ghost"
				>
					<X className="size-3" />
				</Button>
			</div>

			{/* Body */}
			<div className="flex flex-1 overflow-hidden">
				{/* Settings sidebar nav */}
				<nav className="w-56 shrink-0 border-r border-border">
					<ScrollArea className="h-full">
						<div className="flex flex-col gap-0.5 p-3">
							{navCategories.map((cat) => {
								if (cat === "Providers") {
									return (
										<div key={cat}>
											<Button
												className={cn(
													"flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors",
													activeNav === "Providers"
														? "bg-accent text-accent-foreground font-medium"
														: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
												)}
												onClick={() => {
													selectSection("Providers");
													setProvidersExpanded((p) => !p);
												}}
												variant="ghost"
											>
												<span>Providers</span>
												{providersExpanded ? (
													<ChevronDown className="size-3" />
												) : (
													<ChevronRight className="size-3" />
												)}
											</Button>
											{providersExpanded && (
												<div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-border pl-2">
													{enabledProviders.map((prov) => (
														<Button
															className={cn(
																"justify-start",
																selectedProviderId === prov.id
																	? "bg-accent/80 text-foreground"
																	: "text-muted-foreground hover:text-foreground hover:bg-accent/30",
															)}
															disabled={oauthSigningProviderId === prov.id}
															key={prov.id}
															onClick={() => openProviderDetail(prov.id)}
															variant="ghost"
														>
															<span className="truncate">{prov.name}</span>
														</Button>
													))}
												</div>
											)}
										</div>
									);
								}
								return (
									<Button
										className={cn(
											"justify-start",
											activeNav === cat && !selectedProviderId
												? "bg-accent text-accent-foreground font-medium"
												: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
										)}
										key={cat}
										onClick={() => {
											selectSection(cat);
										}}
										variant="ghost"
									>
										{cat}
									</Button>
								);
							})}
						</div>
					</ScrollArea>
				</nav>

				{/* Content area */}
				<div className="flex-1 overflow-hidden">
					{activeNav === "Providers" && selectedProvider ? (
						<ProviderDetailContent
							modelsError={modelsErrorByProvider[selectedProvider.id] ?? null}
							modelsLoading={
								modelsLoadingByProvider[selectedProvider.id] ?? false
							}
							oauthLoginPending={oauthSigningProviderId === selectedProvider.id}
							onBack={backToProviderList}
							onLoadModels={() => void loadProviderModels(selectedProvider.id)}
							onOAuthLogin={
								isOAuthProvider(selectedProvider.id)
									? () => void runOAuthProviderLogin(selectedProvider.id)
									: undefined
							}
							onUpdate={(updates) =>
								updateProvider(selectedProvider.id, updates)
							}
							provider={selectedProvider}
						/>
					) : activeNav === "Providers" ? (
						addingProvider ? (
							<AddProviderContent
								existingProviderIds={providers.map((provider) => provider.id)}
								onBack={backToProviderList}
								onSave={saveNewProvider}
							/>
						) : providersLoading ? (
							<div className="flex h-full items-center justify-center">
								<p className="text-sm text-muted-foreground">
									Loading providers...
								</p>
							</div>
						) : providerCatalogError ? (
							<div className="flex h-full items-center justify-center">
								<p className="max-w-xl px-4 text-center text-sm text-destructive">
									Failed to load providers: {providerCatalogError}
								</p>
							</div>
						) : (
							<ProviderListContent
								onAddProvider={openAddProvider}
								onConfigure={openProviderDetail}
								onToggle={toggleProvider}
								providers={providers}
							/>
						)
					) : activeNav === "MCP" ? (
						<McpServersContent />
					) : activeNav === "Channels" ? (
						<ChannelsContent />
					) : activeNav === "Schedules" ? (
						<RoutineSchedulesContent />
					) : activeNav === "Customizations" ? (
						<RulesView />
					) : activeNav === "Account" ? (
						<AccountView />
					) : activeNav === "General" ? (
						<GeneralSettingsContent
							onThemeChange={onThemeChange}
							theme={theme}
						/>
					) : (
						<div className="flex h-full items-center justify-center">
							<p className="text-sm text-muted-foreground">
								{activeNav} settings coming soon.
							</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function GeneralSettingsContent({
	onThemeChange,
	theme,
}: {
	onThemeChange: (theme: Theme) => void;
	theme: Theme;
}) {
	const [telemetryOptOut, setTelemetryOptOut] = useState(false);
	const [telemetryLoading, setTelemetryLoading] = useState(true);
	const [telemetrySaving, setTelemetrySaving] = useState(false);
	const [telemetryError, setTelemetryError] = useState<string | null>(null);

	const loadGlobalSettings = useCallback(async () => {
		setTelemetryLoading(true);
		setTelemetryError(null);
		try {
			const settings = await desktopClient.invoke<GlobalSettingsResponse>(
				"get_global_settings",
			);
			setTelemetryOptOut(settings.telemetryOptOut);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setTelemetryError(message);
		} finally {
			setTelemetryLoading(false);
		}
	}, []);

	useEffect(() => {
		const timeoutId = window.setTimeout(() => {
			void loadGlobalSettings();
		}, 0);
		return () => window.clearTimeout(timeoutId);
	}, [loadGlobalSettings]);

	const updateTelemetryOptOut = async (nextValue: boolean) => {
		const previousValue = telemetryOptOut;
		setTelemetryOptOut(nextValue);
		setTelemetrySaving(true);
		setTelemetryError(null);
		try {
			const settings = await desktopClient.invoke<GlobalSettingsResponse>(
				"set_telemetry_opt_out",
				{
					telemetry_opt_out: nextValue,
				},
			);
			setTelemetryOptOut(settings.telemetryOptOut);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setTelemetryOptOut(previousValue);
			setTelemetryError(message);
		} finally {
			setTelemetrySaving(false);
		}
	};

	return (
		<ScrollArea className="h-full">
			<div className="mx-auto max-w-3xl px-8 py-6">
				<div className="mb-6">
					<h2 className="text-lg font-semibold text-foreground">General</h2>
				</div>
				<section className="rounded-lg border border-border p-5">
					<div className="flex items-center justify-between gap-5 max-[720px]:flex-col max-[720px]:items-stretch">
						<div>
							<p className="text-sm font-medium text-foreground">Theme</p>
							<p className="mt-1 text-xs text-muted-foreground">
								Use the light or dark Cline Hub interface.
							</p>
						</div>
						<div className="flex items-center gap-2 max-[720px]:justify-start">
							<Button
								onClick={() => onThemeChange("dark")}
								type="button"
								variant={theme === "dark" ? "default" : "outline"}
							>
								<Moon className="size-4" />
								Dark
							</Button>
							<Button
								onClick={() => onThemeChange("light")}
								type="button"
								variant={theme === "light" ? "default" : "outline"}
							>
								<Sun className="size-4" />
								Light
							</Button>
						</div>
					</div>
				</section>
				<section className="mt-4 rounded-lg border border-border p-5">
					<div className="flex items-center justify-between gap-5 max-[720px]:flex-col max-[720px]:items-stretch">
						<div>
							<p className="text-sm font-medium text-foreground">Telemetry</p>
							<p className="mt-1 text-xs text-muted-foreground">
								Enable error and usage report to help us improve Cline.
							</p>
							{telemetryError ? (
								<p className="mt-2 text-xs text-destructive">
									Failed to update telemetry setting: {telemetryError}
								</p>
							) : null}
						</div>
						<Switch
							aria-label="Telemetry opt-out"
							checked={!telemetryOptOut} // If opt-out is true, the switch should be off (unchecked)
							disabled={telemetryLoading || telemetrySaving}
							onCheckedChange={(checked) => void updateTelemetryOptOut(checked)}
						/>
					</div>
				</section>
			</div>
		</ScrollArea>
	);
}
