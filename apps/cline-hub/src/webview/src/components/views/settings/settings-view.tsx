import { ChevronDown, ChevronRight, X } from "lucide-react";
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
type GlobalSettingsResponse = {
	telemetryOptOut: boolean;
	autoUpdateEnabled: boolean;
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
	chrome = "full",
	initialSection = "General",
	onClose,
	onNavigateSection,
}: {
	chrome?: "full" | "content";
	initialSection?: SettingsSection;
	onClose: () => void;
	onNavigateSection?: (section: SettingsSection) => void;
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
		if (activeNav !== "Providers") {
			return;
		}
		const timeoutId = window.setTimeout(() => {
			void loadProviderCatalog();
		}, 0);
		return () => window.clearTimeout(timeoutId);
	}, [activeNav, loadProviderCatalog]);

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

	const content =
		activeNav === "Providers" && selectedProvider ? (
			<ProviderDetailContent
				modelsError={modelsErrorByProvider[selectedProvider.id] ?? null}
				modelsLoading={modelsLoadingByProvider[selectedProvider.id] ?? false}
				oauthLoginPending={oauthSigningProviderId === selectedProvider.id}
				onBack={backToProviderList}
				onLoadModels={() => void loadProviderModels(selectedProvider.id)}
				onOAuthLogin={
					isOAuthProvider(selectedProvider.id)
						? () => void runOAuthProviderLogin(selectedProvider.id)
						: undefined
				}
				onUpdate={(updates) => updateProvider(selectedProvider.id, updates)}
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
					<p className="text-sm text-muted-foreground">Loading providers...</p>
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
			<GeneralSettingsContent />
		) : (
			<div className="flex h-full items-center justify-center">
				<p className="text-sm text-muted-foreground">
					{activeNav} settings coming soon.
				</p>
			</div>
		);

	if (chrome === "content") {
		return (
			<div className="h-full overflow-hidden bg-background">{content}</div>
		);
	}

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
				<div className="flex-1 overflow-hidden">{content}</div>
			</div>
		</div>
	);
}

function GeneralSettingsContent() {
	const [telemetryOptOut, setTelemetryOptOut] = useState(false);
	const [telemetryLoading, setTelemetryLoading] = useState(true);
	const [telemetrySaving, setTelemetrySaving] = useState(false);
	const [telemetryError, setTelemetryError] = useState<string | null>(null);
	const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true);
	const [autoUpdateLoading, setAutoUpdateLoading] = useState(true);
	const [autoUpdateSaving, setAutoUpdateSaving] = useState(false);
	const [autoUpdateError, setAutoUpdateError] = useState<string | null>(null);

	const loadGlobalSettings = useCallback(async () => {
		setTelemetryLoading(true);
		setTelemetryError(null);
		setAutoUpdateLoading(true);
		setAutoUpdateError(null);
		try {
			const settings = await desktopClient.invoke<GlobalSettingsResponse>(
				"get_global_settings",
			);
			setTelemetryOptOut(settings.telemetryOptOut);
			setAutoUpdateEnabled(settings.autoUpdateEnabled);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setTelemetryError(message);
			setAutoUpdateError(message);
		} finally {
			setTelemetryLoading(false);
			setAutoUpdateLoading(false);
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

	const updateAutoUpdateEnabled = async (nextValue: boolean) => {
		const previousValue = autoUpdateEnabled;
		setAutoUpdateEnabled(nextValue);
		setAutoUpdateSaving(true);
		setAutoUpdateError(null);
		try {
			const settings = await desktopClient.invoke<GlobalSettingsResponse>(
				"set_auto_update_enabled",
				{
					auto_update_enabled: nextValue,
				},
			);
			setAutoUpdateEnabled(settings.autoUpdateEnabled);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setAutoUpdateEnabled(previousValue);
			setAutoUpdateError(message);
		} finally {
			setAutoUpdateSaving(false);
		}
	};

	return (
		<ScrollArea className="h-full">
			<div className="px-18 py-10 max-[1200px]:px-8 max-[720px]:px-4 max-[720px]:py-5">
				<div className="mb-12">
					<h1 className="text-[32px] font-semibold leading-none tracking-normal text-foreground">
						General
					</h1>
				</div>
				<section className="max-w-[86rem]">
					<div className="flex min-h-20 items-center justify-between gap-5 border-b max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:py-4">
						<div>
							<p className="text-[17px] font-semibold text-foreground">
								Auto update
							</p>
							<p className="mt-1 text-[15px] text-muted-foreground">
								Automatically install CLI updates on startup.
							</p>
							{autoUpdateError ? (
								<p className="mt-2 text-xs text-destructive">
									Failed to update auto update setting: {autoUpdateError}
								</p>
							) : null}
						</div>
						<Switch
							aria-label="Auto update"
							checked={autoUpdateEnabled}
							disabled={autoUpdateLoading || autoUpdateSaving}
							onCheckedChange={(checked) =>
								void updateAutoUpdateEnabled(checked)
							}
						/>
					</div>
					<div className="flex min-h-20 items-center justify-between gap-5 border-b max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:py-4">
						<div>
							<p className="text-[17px] font-semibold text-foreground">
								Telemetry
							</p>
							<p className="mt-1 text-[15px] text-muted-foreground">
								Enable error and usage report to help us improve Cline.
							</p>
							{telemetryError ? (
								<p className="mt-2 text-xs text-destructive">
									Failed to update telemetry setting: {telemetryError}
								</p>
							) : null}
						</div>
						<Switch
							aria-label="Telemetry"
							checked={!telemetryOptOut} // If opt-out is true, the switch should be off (unchecked)
							disabled={telemetryLoading || telemetrySaving}
							onCheckedChange={(checked) =>
								void updateTelemetryOptOut(!checked)
							}
						/>
					</div>
				</section>
			</div>
		</ScrollArea>
	);
}
