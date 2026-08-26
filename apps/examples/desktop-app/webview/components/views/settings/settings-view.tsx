import { providerOffersModelTool } from "@cline/llms/browser";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { isBetaVersion, productNameForVersion } from "@/lib/app-channel";
import {
	DEFAULT_APP_FONT_SIZE,
	isAppFontSize,
	MAX_APP_FONT_SIZE,
	MIN_APP_FONT_SIZE,
	readStoredAppFontSize,
	setStoredAppFontSize,
	subscribeToAppFontSize,
} from "@/lib/app-font-size";
import {
	APP_ICONS,
	type AppIconId,
	appIconAssetPath,
	DEFAULT_APP_ICON,
	readStoredAppIcon,
	setStoredAppIcon,
} from "@/lib/app-icon";
import { desktopClient } from "@/lib/desktop-client";
import { resetOnboarding } from "@/lib/onboarding";
import {
	getProviderAuthKind,
	isProviderConnected,
} from "@/lib/provider-connection";
import {
	fetchProviderCatalog,
	invalidateProviderCatalogCache,
	notifyVoiceInputSettingsChanged,
	publishProviderModels,
	subscribeToProviderCatalogInvalidation,
} from "@/lib/provider-model-catalog";
import type {
	Provider,
	ProviderCatalogResponse,
	ProviderModelsResponse,
	ProviderSettingsUpdate,
} from "@/lib/provider-schema";
import {
	type HubAccent,
	type HubTheme,
	readStoredHubAccent,
	readStoredHubTheme,
	readSystemHubTheme,
	setStoredHubAccent,
	setStoredHubTheme,
} from "@/lib/theme";
import { cn } from "@/lib/utils";
import { MarketplaceView } from "../marketplace-view";
import { PageFrame, PageHeader } from "../page-layout";
import { AccountView } from "./account-view";
import { AddProviderContent, type AddProviderPayload } from "./add-provider";
import { ChannelsContent } from "./channels-view";
import { CustomizeView } from "./customize-view";
import { NotificationSettings } from "./notification-settings";
import {
	ProviderDetailContent,
	ProviderListContent,
} from "./provider-list-view";
import { RoutineSchedulesContent } from "./routine-view";
import type { SettingsSection } from "./sections";
import { toSettingsPatch } from "./settings-patch";
import { VoiceInputContent } from "./voice-input-view";

// Nav categories live in ./sections so the always-mounted sidebar can import
// them without pulling this module graph into the initial bundle.
export {
	CUSTOMIZATION_SECTIONS,
	SETTINGS_SECTIONS,
	type SettingsSection,
} from "./sections";

type GlobalSettingsResponse = {
	telemetryOptOut: boolean;
	autoUpdateEnabled: boolean;
	tools?: Partial<Record<"web_search", { enabled: boolean }>>;
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
	section,
	onNavigateSection,
	onOpenSession,
}: {
	section: SettingsSection;
	onNavigateSection: (section: SettingsSection) => void;
	onOpenSession?: (sessionId: string) => void | Promise<void>;
}) {
	const activeNav = section;
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
	// Bumped by every optimistic provider mutation and catalog load. An
	// in-flight catalog response is discarded when the generation moved on,
	// so an older disk snapshot can never overwrite a newer edit.
	const catalogGenerationRef = useRef(0);
	// Bumped when a failed save resyncs the catalog from disk; keys the
	// detail panel so its local field drafts remount from the reloaded
	// props instead of keeping unpersisted values.
	const [detailResetToken, setDetailResetToken] = useState(0);

	useEffect(() => {
		if (section !== "Models") {
			setSelectedProviderId(null);
			setAddingProvider(false);
		}
	}, [section]);

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

	/**
	 * Loads the catalog into view state. Resolves to false when the response
	 * was discarded because a newer mutation or load superseded it while in
	 * flight (so an older disk snapshot never overwrites a newer edit);
	 * callers needing an authoritative resync should retry on false.
	 */
	const loadProviderCatalog = useCallback(async (): Promise<boolean> => {
		const now = Date.now();
		if (
			providerCatalogCache &&
			now - providerCatalogCache.fetchedAt < PROVIDER_CATALOG_CACHE_TTL_MS
		) {
			setProviders(providerCatalogCache.providers);
			setProvidersLoading(false);
			setProviderCatalogError(null);
			return true;
		}

		const generation = ++catalogGenerationRef.current;
		setProvidersLoading(true);
		setProviderCatalogError(null);
		try {
			const payload = await desktopClient.invoke<ProviderCatalogResponse>(
				"list_provider_catalog",
			);
			if (generation !== catalogGenerationRef.current) {
				return false;
			}
			setProvidersWithCache(payload.providers);
		} catch (error) {
			if (generation !== catalogGenerationRef.current) {
				return false;
			}
			const message = error instanceof Error ? error.message : String(error);
			setProviderCatalogError(message);
			setProviders([]);
		} finally {
			setProvidersLoading(false);
		}
		return true;
	}, [setProvidersWithCache]);

	useEffect(() => {
		if (activeNav !== "Models") {
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
		): Promise<boolean> => {
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
				return true;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				window.alert(`Failed to save provider settings for ${id}: ${message}`);
				// The optimistic list update no longer matches disk: resync from
				// the authoritative catalog. Retry when a concurrent edit
				// superseded the in-flight response (that edit performs no
				// reload of its own), then remount the detail panel so its
				// field drafts re-seed from the reloaded state — not before,
				// or they would re-capture the unpersisted optimistic values.
				for (let attempt = 0; attempt < 3; attempt++) {
					providerCatalogCache = null;
					if (await loadProviderCatalog()) {
						break;
					}
				}
				setDetailResetToken((token) => token + 1);
				return false;
			} finally {
				// Keep the shared short-lived catalog cache (composer model
				// selector, onboarding) in sync with the just-saved settings.
				invalidateProviderCatalogCache();
			}
		},
		[loadProviderCatalog],
	);

	const connectProvider = useCallback(
		(id: string) => {
			// Persist an (empty) settings entry so the provider is enabled with
			// whatever credentials it resolves at runtime (env vars, local CLI,
			// keyless endpoints).
			catalogGenerationRef.current++;
			setProvidersWithCache((prev) =>
				prev.map((p) => (p.id === id ? { ...p, enabled: true } : p)),
			);
			void persistProviderSettings(id, { enabled: true });
		},
		[persistProviderSettings, setProvidersWithCache],
	);

	const disconnectProvider = useCallback(
		async (id: string) => {
			catalogGenerationRef.current++;
			setProvidersWithCache((prev) =>
				prev.map((p) =>
					p.id === id
						? {
								...p,
								enabled: false,
								apiKey: undefined,
								oauthAccessTokenPresent: false,
							}
						: p,
				),
			);
			const saved = await persistProviderSettings(id, { enabled: false });
			if (saved) {
				// Disconnecting removes the persisted entry (and the sidecar drops
				// a voice-input selection pointing at it); reload so the view and
				// the chat microphone reflect the real on-disk state.
				providerCatalogCache = null;
				notifyVoiceInputSettingsChanged();
				await loadProviderCatalog();
			}
		},
		[loadProviderCatalog, persistProviderSettings, setProvidersWithCache],
	);

	const updateProvider = useCallback(
		(id: string, updates: ProviderSettingsUpdate) => {
			// Saving settings creates the provider's persisted entry, which is
			// what "connected" means for keyless providers — reflect it locally.
			catalogGenerationRef.current++;
			setProvidersWithCache((prev) =>
				prev.map((p) =>
					p.id === id
						? {
								...p,
								...updates,
								enabled: true,
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
				publishProviderModels(id, payload.models);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setModelsErrorByProvider((prev) => ({ ...prev, [id]: message }));
			} finally {
				setModelsLoadingByProvider((prev) => ({ ...prev, [id]: false }));
			}
		},
		[setProvidersWithCache],
	);

	const updateProviderModels = useCallback(
		async (id: string, models: string[]) => {
			setModelsLoadingByProvider((prev) => ({ ...prev, [id]: true }));
			setModelsErrorByProvider((prev) => ({ ...prev, [id]: null }));
			try {
				await desktopClient.invoke("update_provider_models", {
					provider: id,
					models,
				});
				await loadProviderModels(id);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setModelsErrorByProvider((prev) => ({ ...prev, [id]: message }));
			} finally {
				setModelsLoadingByProvider((prev) => ({ ...prev, [id]: false }));
			}
		},
		[loadProviderModels],
	);

	// The detail panel is always open: with no explicit selection, default to
	// the first connected provider (the one in use), then the first provider.
	const effectiveSelectedProviderId =
		selectedProviderId ??
		providers.find(isProviderConnected)?.id ??
		providers[0]?.id ??
		null;
	const selectedProvider = effectiveSelectedProviderId
		? (providers.find((p) => p.id === effectiveSelectedProviderId) ?? null)
		: null;

	const usesOAuth = (provider: Provider) =>
		getProviderAuthKind(provider) === "oauth";

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
			// The shared catalog cache (composer selector, welcome setup notice)
			// must learn about the new OAuth connection too, not just this
			// view's local provider state.
			invalidateProviderCatalogCache();
			setSelectedProviderId(id);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			window.alert(`Failed to sign in to ${id}: ${message}`);
		} finally {
			setOauthSigningProviderId(null);
		}
	};

	const openProviderDetail = (id: string) => {
		onNavigateSection("Models");
		setSelectedProviderId(id);
	};

	useEffect(() => {
		if (!effectiveSelectedProviderId) {
			return;
		}
		const timeoutId = window.setTimeout(() => {
			void loadProviderModels(effectiveSelectedProviderId);
		}, 0);
		return () => window.clearTimeout(timeoutId);
	}, [loadProviderModels, effectiveSelectedProviderId]);

	const backToProviderList = () => {
		onNavigateSection("Models");
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
			invalidateProviderCatalogCache();
			await loadProviderCatalog();
			setAddingProvider(false);
			setSelectedProviderId(payload.providerId);
		},
		[loadProviderCatalog],
	);

	const openAddProvider = () => {
		onNavigateSection("Models");
		setAddingProvider(true);
	};

	const addProviderDialog = (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					setAddingProvider(false);
				}
			}}
			open={addingProvider}
		>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>Add Provider</DialogTitle>
					<DialogDescription>
						Add an OpenAI-compatible provider and choose its available models.
					</DialogDescription>
				</DialogHeader>
				<AddProviderContent
					existingProviderIds={providers.map((provider) => provider.id)}
					onBack={() => setAddingProvider(false)}
					onSave={saveNewProvider}
					variant="dialog"
				/>
			</DialogContent>
		</Dialog>
	);

	const providerContent = providersLoading ? (
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
			{/* min-h-0/min-w-0: grid items default to min-size auto, which lets
			    the pane grow past its track and leaves the inner ScrollArea with
			    nothing to scroll. */}
			<div className="min-h-0 min-w-0 overflow-hidden">
				<ProviderListContent
					onAddProvider={openAddProvider}
					onConfigure={openProviderDetail}
					providers={providers}
					selectedProviderId={selectedProvider.id}
					variant="panel"
				/>
			</div>
			<aside className="min-h-0 overflow-hidden border-l bg-background max-[1100px]:border-l-0 max-[1100px]:border-t">
				<ProviderDetailContent
					key={`${selectedProvider.id}:${detailResetToken}`}
					modelsError={modelsErrorByProvider[selectedProvider.id] ?? null}
					modelsLoading={modelsLoadingByProvider[selectedProvider.id] ?? false}
					oauthLoginPending={oauthSigningProviderId === selectedProvider.id}
					onBack={backToProviderList}
					onConnect={() => connectProvider(selectedProvider.id)}
					onDisconnect={() => void disconnectProvider(selectedProvider.id)}
					onLoadModels={() => void loadProviderModels(selectedProvider.id)}
					onUpdateModels={(models) =>
						void updateProviderModels(selectedProvider.id, models)
					}
					onOAuthLogin={
						usesOAuth(selectedProvider)
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
			providers={providers}
		/>
	);

	const content =
		activeNav === "Models" ? (
			<>
				{providerContent}
				{addProviderDialog}
			</>
		) : activeNav === "Voice" ? (
			<VoiceInputContent
				onOpenModelProviders={() => onNavigateSection("Models")}
			/>
		) : activeNav === "Customize" ? (
			<CustomizeView
				onOpenMarketplace={() => onNavigateSection("Marketplace")}
			/>
		) : activeNav === "Marketplace" ? (
			<MarketplaceView
				onOpenInstalled={() => onNavigateSection("Customize")}
				variant="directory"
			/>
		) : activeNav === "Channels" ? (
			<ChannelsContent />
		) : activeNav === "Schedules" ? (
			<RoutineSchedulesContent onOpenSession={onOpenSession} />
		) : activeNav === "Account" ? (
			<AccountView />
		) : activeNav === "General" ? (
			<GeneralSettingsContent
				onOpenModelProviders={() => onNavigateSection("Models")}
			/>
		) : (
			<div className="flex h-full items-center justify-center">
				<p className="text-sm text-muted-foreground">
					{activeNav} settings coming soon.
				</p>
			</div>
		);

	return (
		<div className="grid h-full grid-rows-[3rem_minmax(0,1fr)] overflow-hidden bg-background md:block">
			<div aria-hidden="true" className="md:hidden" />
			<div className="min-h-0 overflow-hidden md:h-full">{content}</div>
		</div>
	);
}

/**
 * Swatches shown in the accent picker. The swatch color is the accent's
 * light-mode primary (see the [data-cline-accent] blocks in globals.css);
 * violet reads the live brand token so it always matches the default theme.
 */
const ACCENT_OPTIONS: { id: HubAccent; label: string; swatch: string }[] = [
	{ id: "violet", label: "Violet", swatch: "var(--brand-violet)" },
	{ id: "graphite", label: "Graphite", swatch: "oklch(0.27 0.012 248)" },
	{ id: "cyan", label: "Cyan", swatch: "oklch(0.6 0.12 222)" },
	{ id: "pink", label: "Pink", swatch: "oklch(0.75 0.1 354)" },
	{ id: "espresso", label: "Espresso", swatch: "oklch(0.36 0.035 35)" },
	{ id: "ember", label: "Ember", swatch: "oklch(0.6 0.19 33)" },
];

function GeneralSettingsContent({
	onOpenModelProviders,
}: {
	onOpenModelProviders: () => void;
}) {
	const [theme, setTheme] = useState<HubTheme>(() => {
		if (typeof window === "undefined") return "light";
		return readStoredHubTheme() ?? readSystemHubTheme();
	});
	const [accent, setAccent] = useState<HubAccent>(() => {
		if (typeof window === "undefined") return "violet";
		return readStoredHubAccent();
	});
	const [fontSize, setFontSize] = useState(() => {
		if (typeof window === "undefined") return DEFAULT_APP_FONT_SIZE;
		return readStoredAppFontSize();
	});
	const [appIcon, setAppIcon] = useState<AppIconId>(() => {
		if (typeof window === "undefined") return DEFAULT_APP_ICON;
		return readStoredAppIcon();
	});
	const [appIconError, setAppIconError] = useState<string | null>(null);
	const appIconRequestRef = useRef(0);
	const [telemetryOptOut, setTelemetryOptOut] = useState(false);
	const [telemetryLoading, setTelemetryLoading] = useState(true);
	const [telemetrySaving, setTelemetrySaving] = useState(false);
	const [telemetryError, setTelemetryError] = useState<string | null>(null);
	const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true);
	const [autoUpdateLoading, setAutoUpdateLoading] = useState(true);
	const [autoUpdateSaving, setAutoUpdateSaving] = useState(false);
	const [autoUpdateError, setAutoUpdateError] = useState<string | null>(null);
	const [webSearchEnabled, setWebSearchEnabled] = useState(false);
	const [webSearchLoading, setWebSearchLoading] = useState(true);
	const [webSearchSaving, setWebSearchSaving] = useState(false);
	const [webSearchError, setWebSearchError] = useState<string | null>(null);
	// Connected providers that offer native web search; null until the
	// catalog loads. The toggle silently does nothing with other providers,
	// so the row spells out whether it will actually take effect.
	const [webSearchReadyProviders, setWebSearchReadyProviders] = useState<
		string[] | null
	>(null);
	const [appVersion, setAppVersion] = useState<string | null>(null);

	useEffect(() => subscribeToAppFontSize(setFontSize), []);

	useEffect(() => {
		let cancelled = false;
		const loadWebSearchSupport = () => {
			void fetchProviderCatalog()
				.then((payload) => {
					if (cancelled) return;
					setWebSearchReadyProviders(
						(payload.providers ?? [])
							.filter(
								(provider) =>
									provider.enabled &&
									providerOffersModelTool(provider.id, "web_search"),
							)
							.map((provider) => provider.name),
					);
				})
				.catch(() => {
					// Support status is best-effort; the toggle works without it.
				});
		};
		loadWebSearchSupport();
		// Provider saves invalidate the catalog cache when they complete, so
		// refetching on invalidation keeps the status current even when the
		// user navigates here while a save is still in flight.
		const unsubscribe =
			subscribeToProviderCatalogInvalidation(loadWebSearchSupport);
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		void desktopClient
			.invoke<{ appVersion?: unknown }>("get_process_context")
			.then((context) => {
				if (cancelled) {
					return;
				}
				const version =
					typeof context?.appVersion === "string"
						? context.appVersion.trim()
						: "";
				setAppVersion(version || null);
			})
			.catch(() => {
				// Leave the About row versionless if the sidecar is unreachable.
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const loadGlobalSettings = useCallback(async () => {
		setTelemetryLoading(true);
		setTelemetryError(null);
		setAutoUpdateLoading(true);
		setAutoUpdateError(null);
		setWebSearchLoading(true);
		setWebSearchError(null);
		try {
			const settings = await desktopClient.invoke<GlobalSettingsResponse>(
				"get_global_settings",
			);
			setTelemetryOptOut(settings.telemetryOptOut);
			setAutoUpdateEnabled(settings.autoUpdateEnabled);
			setWebSearchEnabled(settings.tools?.web_search?.enabled === true);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setTelemetryError(message);
			setAutoUpdateError(message);
			setWebSearchError(message);
		} finally {
			setTelemetryLoading(false);
			setAutoUpdateLoading(false);
			setWebSearchLoading(false);
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
				{ telemetry_opt_out: nextValue },
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
				{ auto_update_enabled: nextValue },
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

	const updateWebSearchEnabled = async (nextValue: boolean) => {
		const previousValue = webSearchEnabled;
		setWebSearchEnabled(nextValue);
		setWebSearchSaving(true);
		setWebSearchError(null);
		try {
			const settings = await desktopClient.invoke<GlobalSettingsResponse>(
				"set_web_search_enabled",
				{ web_search_enabled: nextValue },
			);
			setWebSearchEnabled(settings.tools?.web_search?.enabled === true);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setWebSearchEnabled(previousValue);
			setWebSearchError(message);
		} finally {
			setWebSearchSaving(false);
		}
	};

	const updateTheme = (darkModeEnabled: boolean) => {
		const nextTheme = darkModeEnabled ? "dark" : "light";
		setTheme(setStoredHubTheme(nextTheme));
	};

	const updateAccent = (nextAccent: HubAccent) => {
		setAccent(setStoredHubAccent(nextAccent));
	};

	const updateFontSizePreference = (nextFontSize: number) => {
		if (isAppFontSize(nextFontSize)) {
			setFontSize(setStoredAppFontSize(nextFontSize));
		}
	};

	const updateFontSize = ([nextFontSize]: number[]) => {
		updateFontSizePreference(nextFontSize);
	};

	const updateAppIcon = async (nextIcon: AppIconId) => {
		const requestId = ++appIconRequestRef.current;
		const previousIcon = appIcon;
		setAppIcon(nextIcon);
		setAppIconError(null);
		try {
			await setStoredAppIcon(nextIcon);
		} catch (error) {
			// A newer selection supersedes this request; rolling back now
			// would clobber it.
			if (appIconRequestRef.current !== requestId) {
				return;
			}
			setAppIcon(previousIcon);
			setAppIconError(error instanceof Error ? error.message : String(error));
			// Storage was written before the native call failed; roll it back
			// so the persisted choice matches what the dock actually shows.
			await setStoredAppIcon(previousIcon).catch(() => {});
		}
	};

	// resetOnboarding dispatches ONBOARDING_RESET_EVENT, which the app shell
	// listens for to re-enter the first-run flow immediately.
	const replayOnboarding = () => {
		resetOnboarding();
	};

	return (
		<PageFrame>
			<PageHeader
				description="Manage desktop preferences for this browser and CLI environment."
				title="Settings"
			/>
			<section className="max-w-344">
				<NotificationSettings />
				<div className="flex py-4 items-center justify-between gap-5 border-b max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:py-4">
					<div className="flex flex-col gap-1">
						<p className="text-base font-semibold text-foreground">Dark mode</p>
						<p className="text-sm text-muted-foreground">
							Keep the desktop interface in dark mode on this browser.
						</p>
					</div>
					<Switch
						aria-label="Dark mode"
						checked={theme === "dark"}
						onCheckedChange={updateTheme}
					/>
				</div>
				<div className="flex items-center justify-between gap-5 border-b py-4 max-[720px]:flex-col max-[720px]:items-stretch">
					<div className="flex flex-col gap-1">
						<p className="text-base font-semibold text-foreground">Font size</p>
						<p className="text-sm text-muted-foreground">
							Adjust the size of text and interface elements throughout the app.
						</p>
					</div>
					<div className="flex w-64 shrink-0 items-center gap-3 max-[720px]:w-full">
						<Button
							aria-label="Decrease font size"
							className="size-7"
							disabled={fontSize === MIN_APP_FONT_SIZE}
							onClick={() => updateFontSizePreference(fontSize - 1)}
							size="icon"
							type="button"
							variant="outline"
						>
							<Minus />
						</Button>
						<Slider
							aria-label="Font size"
							aria-valuetext={`${fontSize} pixels`}
							max={MAX_APP_FONT_SIZE}
							min={MIN_APP_FONT_SIZE}
							onValueChange={updateFontSize}
							step={1}
							value={[fontSize]}
						/>
						<Button
							aria-label="Increase font size"
							className="size-7"
							disabled={fontSize === MAX_APP_FONT_SIZE}
							onClick={() => updateFontSizePreference(fontSize + 1)}
							size="icon"
							type="button"
							variant="outline"
						>
							<Plus />
						</Button>
						<output
							aria-label="Selected font size"
							className="w-10 shrink-0 text-right font-mono text-sm tabular-nums text-foreground"
						>
							{fontSize}px
						</output>
					</div>
				</div>
				<div className="flex py-4 items-center justify-between gap-5 border-b max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:py-4">
					<div className="flex flex-col gap-1">
						<p className="text-base font-semibold text-foreground">
							Accent color
						</p>
						<p className="text-sm text-muted-foreground">
							Tint buttons, links, and highlights across the app.
						</p>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						{ACCENT_OPTIONS.map((option) => (
							<button
								aria-label={option.label}
								aria-pressed={accent === option.id}
								className={cn(
									"size-7 rounded-full border border-foreground/10 transition-transform hover:scale-110",
									accent === option.id &&
										"ring-2 ring-ring ring-offset-2 ring-offset-background",
								)}
								key={option.id}
								onClick={() => updateAccent(option.id)}
								style={{ backgroundColor: option.swatch }}
								title={option.label}
								type="button"
							/>
						))}
					</div>
				</div>
				<div className="flex items-center justify-between gap-5 border-b py-4 max-[720px]:flex-col max-[720px]:items-stretch">
					<div className="flex flex-col gap-1">
						<p className="text-base font-semibold text-foreground">App icon</p>
						<p className="text-sm text-muted-foreground">
							Pick the icon Cline shows in the Dock.
						</p>
						{appIconError ? (
							<p className="mt-2 text-xs text-destructive" role="alert">
								Failed to change app icon: {appIconError}
							</p>
						) : null}
					</div>
					<div className="flex shrink-0 items-start gap-2.5">
						{APP_ICONS.map((icon) => (
							<button
								aria-label={icon.label}
								aria-pressed={appIcon === icon.id}
								className="group flex flex-col items-center gap-2"
								key={icon.id}
								onClick={() => void updateAppIcon(icon.id)}
								type="button"
							>
								<img
									alt=""
									className={cn(
										"size-14 rounded-2xl transition-transform group-hover:scale-105",
										appIcon === icon.id &&
											"ring-2 ring-ring ring-offset-2 ring-offset-background",
									)}
									draggable={false}
									height={112}
									src={appIconAssetPath(icon.id)}
									width={112}
								/>
								<span
									className={cn(
										"text-xs",
										appIcon === icon.id
											? "font-medium text-foreground"
											: "text-muted-foreground",
									)}
								>
									{icon.label}
								</span>
							</button>
						))}
					</div>
				</div>
				<div className="flex py-4 items-center justify-between gap-5 border-b max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:py-4">
					<div className="flex flex-col gap-1">
						<p className="text-base font-semibold text-foreground">
							Web search
						</p>
						<p className="text-sm text-muted-foreground">
							Let the model search the web during a task. Only providers with
							built-in web search honor this setting; other providers ignore it.
							Applies to new sessions.
						</p>
						{webSearchReadyProviders ===
						null ? null : webSearchReadyProviders.length > 0 ? (
							<p className="text-xs text-muted-foreground">
								Ready to use with {webSearchReadyProviders.join(", ")} on models
								that support it — no extra setup needed.
							</p>
						) : (
							<p className="text-xs text-amber-700 dark:text-amber-300">
								None of your connected providers include built-in web search, so
								this setting has no effect yet.{" "}
								<button
									className="underline underline-offset-2 hover:text-foreground"
									onClick={onOpenModelProviders}
									type="button"
								>
									Connect a provider
								</button>{" "}
								that supports it, such as Anthropic, OpenAI, Google Gemini, or
								Cline.
							</p>
						)}
						{webSearchError ? (
							<p className="mt-2 text-xs text-destructive" role="alert">
								Failed to update web search setting: {webSearchError}
							</p>
						) : null}
					</div>
					<Switch
						aria-label="Web search"
						checked={webSearchEnabled}
						disabled={webSearchLoading || webSearchSaving}
						onCheckedChange={(checked) => void updateWebSearchEnabled(checked)}
					/>
				</div>
				<div className="flex py-4 items-center justify-between gap-5 border-b max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:py-4">
					<div className="flex flex-col gap-1">
						<p className="text-base font-semibold text-foreground">
							Keep CLI up to date
						</p>
						<p className="text-sm text-muted-foreground">
							Automatically update the cline terminal command, which shares your
							sessions and settings with this app. The app itself updates
							separately.
						</p>
						{autoUpdateError ? (
							<p className="mt-2 text-xs text-destructive" role="alert">
								Failed to update CLI auto-update setting: {autoUpdateError}
							</p>
						) : null}
					</div>
					<Switch
						aria-label="Keep CLI up to date"
						checked={autoUpdateEnabled}
						disabled={autoUpdateLoading || autoUpdateSaving}
						onCheckedChange={(checked) => void updateAutoUpdateEnabled(checked)}
					/>
				</div>
				<div className="flex py-4 items-center justify-between gap-5 border-b max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:py-4">
					<div className="flex flex-col gap-1">
						<p className="text-base font-semibold text-foreground">Telemetry</p>
						<p className="text-sm text-muted-foreground">
							Enable error and usage reports to help improve Cline.
						</p>
						{telemetryError ? (
							<p className="mt-2 text-xs text-destructive" role="alert">
								Failed to update telemetry setting: {telemetryError}
							</p>
						) : null}
					</div>
					<Switch
						aria-label="Telemetry"
						checked={!telemetryOptOut}
						disabled={telemetryLoading || telemetrySaving}
						onCheckedChange={(checked) => void updateTelemetryOptOut(!checked)}
					/>
				</div>
				<div className="flex py-4 items-center justify-between gap-5 border-b max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:py-4">
					<div className="flex flex-col gap-1">
						<p className="text-base font-semibold text-foreground">
							New user experience
						</p>
						<p className="text-sm text-muted-foreground">
							Replay the first-run experience new users see when they open Cline
							for the first time.
						</p>
					</div>
					<Button
						className="shrink-0"
						onClick={replayOnboarding}
						size="sm"
						type="button"
						variant="outline"
					>
						<RotateCcw className="size-3" />
						Replay
					</Button>
				</div>
				<div className="flex py-4 items-center justify-between gap-5 max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:py-4">
					<div className="flex flex-col gap-1">
						<p className="text-base font-semibold text-foreground">About</p>
						<p className="text-sm text-muted-foreground">
							{productNameForVersion(appVersion)}
							{appVersion ? ` v${appVersion}` : ""}
							{isBetaVersion(appVersion)
								? " — beta builds install side by side with the stable app and update from the beta channel."
								: ""}
						</p>
					</div>
					{isBetaVersion(appVersion) ? (
						<Badge
							className="shrink-0 uppercase tracking-wide"
							variant="secondary"
						>
							Beta
						</Badge>
					) : null}
				</div>
			</section>
		</PageFrame>
	);
}
