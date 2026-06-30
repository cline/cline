import { X } from "lucide-react";
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
import {
	type HubTheme,
	readStoredHubTheme,
	readSystemHubTheme,
	setStoredHubTheme,
} from "@/lib/theme";
import { cn } from "@/lib/utils";
import { PageFrame, PageHeader } from "../page-layout";
import { AccountView } from "./account-view";
import { AddProviderContent, type AddProviderPayload } from "./add-provider";
import { ChannelsContent } from "./channels-view";
import { CustomizationSectionView, RulesView } from "./extensions-view";
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
	"MCP",
	"Marketplace",
	"Extensions",
	"Channels",
	"Schedules",
	"Account",
] as const;

export type SettingsSection = (typeof navCategories)[number];

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

	const providerContent = addingProvider ? (
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
	) : selectedProvider ? (
		<div className="grid h-full grid-cols-[minmax(24rem,0.95fr)_minmax(28rem,1.05fr)] overflow-hidden max-[1100px]:grid-cols-1 max-[1100px]:grid-rows-[minmax(24rem,0.9fr)_minmax(26rem,1fr)]">
			<ProviderListContent
				onAddProvider={openAddProvider}
				onConfigure={openProviderDetail}
				onToggle={toggleProvider}
				providers={providers}
				selectedProviderId={selectedProvider.id}
				variant="panel"
			/>
			<aside className="min-h-0 overflow-hidden border-l bg-background max-[1100px]:border-l-0 max-[1100px]:border-t">
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
					variant="panel"
				/>
			</aside>
		</div>
	) : (
		<ProviderListContent
			onAddProvider={openAddProvider}
			onConfigure={openProviderDetail}
			onToggle={toggleProvider}
			providers={providers}
		/>
	);

	const content =
		activeNav === "Providers" ? (
			providerContent
		) : activeNav === "MCP" ? (
			<McpServersContent />
		) : activeNav === "Marketplace" ? (
			<CustomizationSectionView catalogPrimitive="mcp" section="MCP" />
		) : activeNav === "Extensions" ? (
			<RulesView />
		) : activeNav === "Channels" ? (
			<ChannelsContent />
		) : activeNav === "Schedules" ? (
			<RoutineSchedulesContent />
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
							{navCategories.map((cat) => (
								<Button
									className={cn(
										"justify-start",
										activeNav === cat
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
							))}
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
	const [theme, setTheme] = useState<HubTheme>(() => {
		if (typeof window === "undefined") return "light";
		return readStoredHubTheme() ?? readSystemHubTheme();
	});

	const updateTheme = (darkModeEnabled: boolean) => {
		const nextTheme = darkModeEnabled ? "dark" : "light";
		setTheme(setStoredHubTheme(nextTheme));
	};

	return (
		<PageFrame>
			<PageHeader
				description="Manage desktop preferences for this browser and CLI environment."
				title="Settings"
			/>
			<section className="max-w-[86rem]">
				<div className="flex min-h-20 items-center justify-between gap-5 border-b max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:py-4">
					<div>
						<p className="text-[17px] font-semibold text-foreground">
							Dark mode
						</p>
						<p className="mt-1 text-[15px] text-muted-foreground">
							Keep the desktop interface in dark mode on this browser.
						</p>
					</div>
					<Switch
						aria-label="Dark mode"
						checked={theme === "dark"}
						onCheckedChange={updateTheme}
					/>
				</div>
			</section>
		</PageFrame>
	);
}
