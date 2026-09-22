import { providerOffersModelTool } from "@cline/llms/browser";
import { Switch } from "@cline/ui";
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
import { toast } from "@/hooks/use-toast";
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
	appIconSurface,
	DEFAULT_APP_ICON,
	readStoredAppIcon,
	setStoredAppIcon,
} from "@/lib/app-icon";
import { desktopClient } from "@/lib/desktop-client";
import { applyAppLocale, useTranslation } from "@/lib/i18n";
import {
	APP_LOCALES,
	type AppLocalePreference,
	readStoredLocalePreference,
	resolveAppLocale,
} from "@/lib/locale";
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
import { MarketplaceExplorerView } from "../marketplace-explorer-view";
import { PageFrame, PageHeader } from "../page-layout";
import { AccountView } from "./account-view";
import { AddProviderContent, type AddProviderPayload } from "./add-provider";
import { ChannelsContent } from "./channels-view";
import { CustomizeView } from "./customize-view";
import { ImportContent } from "./import-view";
import { NotificationSettings } from "./notification-settings";
import {
	ProviderDetailContent,
	ProviderListContent,
} from "./provider-list-view";
import { RemoteEnvironmentsContent } from "./remote-environments-view";
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

// Section ids double as navigation state, so only the display label is
// localized (mirrors the private map in agent-sidebar.tsx; the ids live in
// ./sections).
const SECTION_LABEL_KEYS: Record<SettingsSection, string> = {
	General: "settings.section.general",
	"API Providers": "settings.section.apiProviders",
	Voice: "settings.section.voice",
	Channels: "settings.section.channels",
	Schedules: "settings.section.schedules",
	Import: "settings.section.import",
	Remote: "settings.section.remote",
	Account: "settings.section.account",
	Customize: "settings.section.customize.installed",
	Marketplace: "settings.section.customize.marketplace",
};

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
	const { t } = useTranslation();
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
		if (section !== "API Providers") {
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
		if (activeNav !== "API Providers") {
			return;
		}
		const timeoutId = window.setTimeout(() => {
			void loadProviderCatalog();
		}, 0);
		return () => window.clearTimeout(timeoutId);
	}, [activeNav, loadProviderCatalog]);

	/**
	 * Silently refreshes view state from the authoritative catalog after a
	 * successful save, without toggling the loading screen. Optimistic
	 * mutations can't know sidecar-computed fields (`configured`), so the
	 * Configured badge would otherwise stay stale until a remount. Claims a
	 * new generation like loadProviderCatalog, so overlapping resyncs, loads,
	 * and edits always resolve to the newest snapshot: anything older still
	 * in flight is discarded on arrival.
	 */
	const resyncProviderCatalog = useCallback(async () => {
		const generation = ++catalogGenerationRef.current;
		try {
			const payload = await desktopClient.invoke<ProviderCatalogResponse>(
				"list_provider_catalog",
			);
			if (generation !== catalogGenerationRef.current) {
				return;
			}
			setProvidersWithCache(payload.providers);
		} catch {
			// Background refresh only; the optimistic state remains until the
			// next full load.
		}
	}, [setProvidersWithCache]);

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
				// Pick up sidecar-computed readiness (`configured`) for the
				// just-saved settings so the Configured badge and count update
				// without a remount.
				void resyncProviderCatalog();
				return true;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				window.alert(
					t("settings.dialogs.saveProviderSettings.error", {
						message,
						provider: id,
					}),
				);
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
		[loadProviderCatalog, resyncProviderCatalog, t],
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
			// Fetch the authoritative post-login snapshot. The resync claims a
			// new generation, so an older load or resync still in flight can't
			// arrive late and overwrite the just-connected state, and its own
			// response also covers any provider saved moments earlier.
			void resyncProviderCatalog();
			setSelectedProviderId(id);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			window.alert(
				t("settings.dialogs.oauthSignIn.error", { provider: id, message }),
			);
		} finally {
			setOauthSigningProviderId(null);
		}
	};

	const openProviderDetail = (id: string) => {
		onNavigateSection("API Providers");
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
		onNavigateSection("API Providers");
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
		onNavigateSection("API Providers");
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
					<DialogTitle>{t("settings.dialogs.addProvider.title")}</DialogTitle>
					<DialogDescription>
						{t("settings.dialogs.addProvider.description")}
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
			<p className="text-sm text-muted-foreground">
				{t("settings.providers.loading")}
			</p>
		</div>
	) : providerCatalogError ? (
		<div className="flex h-full items-center justify-center">
			<p className="max-w-xl px-4 text-center text-sm text-destructive">
				{t("settings.providers.loadError", { message: providerCatalogError })}
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
		activeNav === "API Providers" ? (
			<>
				{providerContent}
				{addProviderDialog}
			</>
		) : activeNav === "Voice" ? (
			<VoiceInputContent
				onOpenModelProviders={() => onNavigateSection("API Providers")}
			/>
		) : activeNav === "Customize" ? (
			<CustomizeView
				onOpenMarketplace={() => onNavigateSection("Marketplace")}
			/>
		) : activeNav === "Marketplace" ? (
			<MarketplaceExplorerView />
		) : activeNav === "Channels" ? (
			<ChannelsContent />
		) : activeNav === "Schedules" ? (
			<RoutineSchedulesContent onOpenSession={onOpenSession} />
		) : activeNav === "Import" ? (
			<ImportContent />
		) : activeNav === "Remote" ? (
			<RemoteEnvironmentsContent />
		) : activeNav === "Account" ? (
			<AccountView />
		) : activeNav === "General" ? (
			<GeneralSettingsContent
				onOpenModelProviders={() => onNavigateSection("API Providers")}
			/>
		) : (
			<div className="flex h-full items-center justify-center">
				<p className="text-sm text-muted-foreground">
					{t("settings.settingsComingSoon", {
						section: t(SECTION_LABEL_KEYS[activeNav]),
					})}
				</p>
			</div>
		);

	return (
		<div className="cline-settings-content h-full overflow-hidden bg-background">
			<div className="h-full min-h-0 overflow-hidden">{content}</div>
		</div>
	);
}

/**
 * Swatches shown in the accent picker. The swatch color is the accent's
 * light-mode primary (see the [data-cline-accent] blocks in globals.css);
 * violet reads the live brand token so it always matches the default theme.
 * Display names live in ACCENT_LABEL_KEYS and are localized at render time.
 */
const ACCENT_OPTIONS: { id: HubAccent; swatch: string }[] = [
	{ id: "violet", swatch: "var(--brand-violet)" },
	{ id: "graphite", swatch: "oklch(0.27 0.012 248)" },
	{ id: "cyan", swatch: "oklch(0.6 0.12 222)" },
	{ id: "pink", swatch: "oklch(0.75 0.1 354)" },
	{ id: "espresso", swatch: "oklch(0.36 0.035 35)" },
	{ id: "ember", swatch: "oklch(0.6 0.19 33)" },
];

const ACCENT_LABEL_KEYS: Record<HubAccent, string> = {
	violet: "settings.general.accentColor.violet",
	graphite: "settings.general.accentColor.graphite",
	cyan: "settings.general.accentColor.cyan",
	pink: "settings.general.accentColor.pink",
	espresso: "settings.general.accentColor.espresso",
	ember: "settings.general.accentColor.ember",
};

// Icon names live in lib/app-icon (shared data), so their display labels are
// localized here at render time.
const APP_ICON_LABEL_KEYS: Record<AppIconId, string> = {
	classic: "settings.general.appIcon.classic",
	midnight: "settings.general.appIcon.midnight",
	hologram: "settings.general.appIcon.hologram",
	chip: "settings.general.appIcon.chip",
};

// Where the app icon shows up per platform; keys mirror the appIconSurface()
// return union.
const APP_ICON_SURFACE_KEYS: Record<"Dock" | "Taskbar" | "desktop", string> = {
	Dock: "settings.general.appIcon.surface.dock",
	Taskbar: "settings.general.appIcon.surface.taskbar",
	desktop: "settings.general.appIcon.surface.desktop",
};

function GeneralSettingsContent({
	onOpenModelProviders,
}: {
	onOpenModelProviders: () => void;
}) {
	const translator = useTranslation();
	const { t } = translator;
	// Self-describing option labels (each language names itself) are shown
	// verbatim in every UI language so users can always find their own.
	const LANGUAGE_OPTIONS = APP_LOCALES.map((locale) => ({
		value: locale,
		label: translator.localeDisplayName(locale),
	}));
	const [localePref, setLocalePref] = useState<AppLocalePreference>(() =>
		readStoredLocalePreference(),
	);
	const resolvedLocaleName = translator.localeDisplayName(
		resolveAppLocale(localePref, navigator.languages ?? []),
	);
	const updateLocalePreference = (next: AppLocalePreference) => {
		setLocalePref(next);
		applyAppLocale(next);
		void desktopClient.invoke("set_language", { language: next }).catch(() => {
			toast({
				title: t("settings.general.language.saveError"),
				variant: "destructive",
			});
		});
	};
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
	const [appIconLocation, setAppIconLocation] = useState<
		"Dock" | "Taskbar" | "desktop"
	>("desktop");
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
	const [cloudSessionsEnabled, setCloudSessionsEnabled] = useState(false);
	const [cloudSessionsLoading, setCloudSessionsLoading] = useState(true);
	const [cloudSessionsSaving, setCloudSessionsSaving] = useState(false);
	const [cloudSessionsError, setCloudSessionsError] = useState<string | null>(
		null,
	);
	// The environment override can differ from the stored opt-in.
	const [cloudSessionsEffective, setCloudSessionsEffective] = useState<
		boolean | null
	>(null);
	// Keep the preview hidden until the rollout service explicitly enables it.
	const [cloudSessionsAvailable, setCloudSessionsAvailable] = useState(false);

	const refreshCloudSessionsEffective = useCallback(async () => {
		try {
			const flags = await desktopClient.invoke<{
				cloudAgents?: boolean;
				cloudAgentsAvailable?: boolean;
			}>("get_feature_flags");
			setCloudSessionsEffective(Boolean(flags.cloudAgents));
			setCloudSessionsAvailable(flags.cloudAgentsAvailable === true);
		} catch {
			setCloudSessionsEffective(null);
			setCloudSessionsAvailable(false);
		}
	}, []);
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

	useEffect(() => setAppIconLocation(appIconSurface(navigator.userAgent)), []);
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
		setCloudSessionsLoading(true);
		setCloudSessionsError(null);
		await Promise.all([
			(async () => {
				try {
					const settings = await desktopClient.invoke<GlobalSettingsResponse>(
						"get_global_settings",
					);
					setTelemetryOptOut(settings.telemetryOptOut);
					setAutoUpdateEnabled(settings.autoUpdateEnabled);
					setWebSearchEnabled(settings.tools?.web_search?.enabled === true);
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					setTelemetryError(message);
					setAutoUpdateError(message);
					setWebSearchError(message);
				} finally {
					setTelemetryLoading(false);
					setAutoUpdateLoading(false);
					setWebSearchLoading(false);
				}
			})(),
			(async () => {
				try {
					const desktopSettings = await desktopClient.invoke<{
						cloudSessionsEnabled: boolean;
					}>("get_desktop_settings");
					setCloudSessionsEnabled(
						Boolean(desktopSettings.cloudSessionsEnabled),
					);
				} catch (error) {
					setCloudSessionsError(
						error instanceof Error ? error.message : String(error),
					);
				} finally {
					setCloudSessionsLoading(false);
				}
			})(),
			refreshCloudSessionsEffective(),
		]);
	}, [refreshCloudSessionsEffective]);

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

	const updateCloudSessionsEnabled = async (nextValue: boolean) => {
		const previousValue = cloudSessionsEnabled;
		setCloudSessionsEnabled(nextValue);
		setCloudSessionsSaving(true);
		setCloudSessionsError(null);
		try {
			const settings = await desktopClient.invoke<{
				cloudSessionsEnabled: boolean;
			}>("set_cloud_sessions_enabled", { cloud_sessions_enabled: nextValue });
			setCloudSessionsEnabled(Boolean(settings.cloudSessionsEnabled));
			await refreshCloudSessionsEffective();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setCloudSessionsEnabled(previousValue);
			setCloudSessionsError(message);
		} finally {
			setCloudSessionsSaving(false);
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
				description={t("settings.general.description")}
				title={t("settings.general.title")}
			/>
			<section className="max-w-344">
				<NotificationSettings />
				<div className="flex items-center justify-between gap-5 border-b py-4 max-[720px]:flex-col max-[720px]:items-stretch">
					<div className="flex flex-col gap-1">
						<p className="text-base font-semibold text-foreground">
							{t("settings.general.language.title")}
						</p>
						<p className="text-sm text-muted-foreground">
							{t("settings.general.language.description")}
						</p>
						{localePref === "system" ? (
							<p className="text-xs text-muted-foreground">
								{t("settings.general.language.systemHint", {
									languageName: resolvedLocaleName,
								})}
							</p>
						) : null}
					</div>
					<div className="w-64 shrink-0 max-[720px]:w-full">
						<select
							aria-label={t("settings.general.language.title")}
							className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
							onChange={(event) =>
								updateLocalePreference(
									event.target.value as AppLocalePreference,
								)
							}
							value={localePref}
						>
							<option value="system">
								{t("settings.general.language.system")}
							</option>
							{LANGUAGE_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</div>
				</div>
				<div className="flex py-4 items-center justify-between gap-5 border-b max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:py-4">
					<div className="flex flex-col gap-1">
						<p className="text-base font-semibold text-foreground">
							{t("settings.general.darkMode.title")}
						</p>
						<p className="text-sm text-muted-foreground">
							{t("settings.general.darkMode.description")}
						</p>
					</div>
					<Switch
						aria-label={t("settings.general.darkMode.aria")}
						checked={theme === "dark"}
						onCheckedChange={updateTheme}
					/>
				</div>
				<div className="flex items-center justify-between gap-5 border-b py-4 max-[720px]:flex-col max-[720px]:items-stretch">
					<div className="flex flex-col gap-1">
						<p className="text-base font-semibold text-foreground">
							{t("settings.general.fontSize.title")}
						</p>
						<p className="text-sm text-muted-foreground">
							{t("settings.general.fontSize.description")}
						</p>
					</div>
					<div className="flex w-64 shrink-0 items-center gap-3 max-[720px]:w-full">
						<Button
							aria-label={t("settings.general.fontSize.decreaseAria")}
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
							aria-label={t("settings.general.fontSize.sliderAria")}
							aria-valuetext={t("settings.general.fontSize.pixelValue", {
								count: fontSize,
							})}
							max={MAX_APP_FONT_SIZE}
							min={MIN_APP_FONT_SIZE}
							onValueChange={updateFontSize}
							step={1}
							value={[fontSize]}
						/>
						<Button
							aria-label={t("settings.general.fontSize.increaseAria")}
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
							aria-label={t("settings.general.fontSize.selectedAria")}
							className="w-10 shrink-0 text-right font-mono text-sm tabular-nums text-foreground"
						>
							{fontSize}px
						</output>
					</div>
				</div>
				<div className="flex py-4 items-center justify-between gap-5 border-b max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:py-4">
					<div className="flex flex-col gap-1">
						<p className="text-base font-semibold text-foreground">
							{t("settings.general.accentColor.title")}
						</p>
						<p className="text-sm text-muted-foreground">
							{t("settings.general.accentColor.description")}
						</p>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						{ACCENT_OPTIONS.map((option) => (
							<button
								aria-label={t(ACCENT_LABEL_KEYS[option.id])}
								aria-pressed={accent === option.id}
								className={cn(
									"size-7 rounded-full border border-foreground/10 transition-transform hover:scale-110",
									accent === option.id &&
										"ring-2 ring-ring ring-offset-2 ring-offset-background",
								)}
								key={option.id}
								onClick={() => updateAccent(option.id)}
								style={{ backgroundColor: option.swatch }}
								title={t(ACCENT_LABEL_KEYS[option.id])}
								type="button"
							/>
						))}
					</div>
				</div>
				<div className="flex items-center justify-between gap-5 border-b py-4 max-[720px]:flex-col max-[720px]:items-stretch">
					<div className="flex flex-col gap-1">
						<p className="text-base font-semibold text-foreground">
							{t("settings.general.appIcon.title")}
						</p>
						<p className="text-sm text-muted-foreground">
							{t("settings.general.appIcon.description", {
								location: t(APP_ICON_SURFACE_KEYS[appIconLocation]),
							})}
						</p>
						{appIconError ? (
							<p className="mt-2 text-xs text-destructive" role="alert">
								{t("settings.general.appIcon.changeError", {
									message: appIconError,
								})}
							</p>
						) : null}
					</div>
					<div className="flex shrink-0 items-start gap-2.5">
						{APP_ICONS.map((icon) => (
							<button
								aria-label={t(APP_ICON_LABEL_KEYS[icon.id])}
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
									{t(APP_ICON_LABEL_KEYS[icon.id])}
								</span>
							</button>
						))}
					</div>
				</div>
				<div className="flex py-4 items-center justify-between gap-5 border-b max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:py-4">
					<div className="flex flex-col gap-1">
						<p className="text-base font-semibold text-foreground">
							{t("settings.general.webSearch.title")}
						</p>
						<p className="text-sm text-muted-foreground">
							{t("settings.general.webSearch.description")}
						</p>
						{webSearchReadyProviders ===
						null ? null : webSearchReadyProviders.length > 0 ? (
							<p className="text-xs text-muted-foreground">
								{t("settings.general.webSearch.readyWith", {
									providers: webSearchReadyProviders.join(", "),
								})}
							</p>
						) : (
							<p className="text-xs text-amber-700 dark:text-amber-300">
								{t("settings.general.webSearch.noneIntro")}{" "}
								<button
									className="underline underline-offset-2 hover:text-foreground"
									onClick={onOpenModelProviders}
									type="button"
								>
									{t("settings.general.webSearch.connectAction")}
								</button>{" "}
								{t("settings.general.webSearch.noneSuffix")}
							</p>
						)}
						{webSearchError ? (
							<p className="mt-2 text-xs text-destructive" role="alert">
								{t("settings.general.webSearch.updateError", {
									message: webSearchError,
								})}
							</p>
						) : null}
					</div>
					<Switch
						aria-label={t("settings.general.webSearch.aria")}
						checked={webSearchEnabled}
						disabled={webSearchLoading || webSearchSaving}
						onCheckedChange={(checked) => void updateWebSearchEnabled(checked)}
					/>
				</div>
				<div className="flex py-4 items-center justify-between gap-5 border-b max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:py-4">
					<div className="flex flex-col gap-1">
						<p className="text-base font-semibold text-foreground">
							{t("settings.general.autoUpdate.title")}
						</p>
						<p className="text-sm text-muted-foreground">
							{t("settings.general.autoUpdate.description")}
						</p>
						{autoUpdateError ? (
							<p className="mt-2 text-xs text-destructive" role="alert">
								{t("settings.general.autoUpdate.updateError", {
									message: autoUpdateError,
								})}
							</p>
						) : null}
					</div>
					<Switch
						aria-label={t("settings.general.autoUpdate.aria")}
						checked={autoUpdateEnabled}
						disabled={autoUpdateLoading || autoUpdateSaving}
						onCheckedChange={(checked) => void updateAutoUpdateEnabled(checked)}
					/>
				</div>
				{cloudSessionsAvailable ? (
					<div className="flex py-4 items-center justify-between gap-5 border-b max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:py-4">
						<div className="flex flex-col gap-1">
							<p className="flex items-center gap-2 text-base font-semibold text-foreground">
								{t("settings.general.cloudSessions.title")}
								<span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-primary">
									{t("settings.general.cloudSessions.preview")}
								</span>
							</p>
							<p className="text-sm text-muted-foreground">
								{t("settings.general.cloudSessions.description")}
							</p>
							{cloudSessionsError ? (
								<p className="mt-2 text-xs text-destructive" role="alert">
									{t("settings.general.cloudSessions.updateError", {
										message: cloudSessionsError,
									})}
								</p>
							) : null}
							{cloudSessionsEffective !== null &&
							!cloudSessionsLoading &&
							cloudSessionsEffective !== cloudSessionsEnabled ? (
								<p className="mt-2 text-xs text-muted-foreground">
									{t("settings.general.cloudSessions.envOverride", {
										state: cloudSessionsEffective
											? t("settings.general.cloudSessions.stateEnabled")
											: t("settings.general.cloudSessions.stateDisabled"),
									})}
								</p>
							) : null}
						</div>
						<Switch
							aria-label={t("settings.general.cloudSessions.aria")}
							checked={cloudSessionsEnabled}
							disabled={cloudSessionsLoading || cloudSessionsSaving}
							onCheckedChange={(checked) =>
								void updateCloudSessionsEnabled(checked)
							}
						/>
					</div>
				) : null}
				<div className="flex py-4 items-center justify-between gap-5 border-b max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:py-4">
					<div className="flex flex-col gap-1">
						<p className="text-base font-semibold text-foreground">
							{t("settings.general.telemetry.title")}
						</p>
						<p className="text-sm text-muted-foreground">
							{t("settings.general.telemetry.description")}
						</p>
						{telemetryError ? (
							<p className="mt-2 text-xs text-destructive" role="alert">
								{t("settings.general.telemetry.updateError", {
									message: telemetryError,
								})}
							</p>
						) : null}
					</div>
					<Switch
						aria-label={t("settings.general.telemetry.aria")}
						checked={!telemetryOptOut}
						disabled={telemetryLoading || telemetrySaving}
						onCheckedChange={(checked) => void updateTelemetryOptOut(!checked)}
					/>
				</div>
				<div className="flex py-4 items-center justify-between gap-5 border-b max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:py-4">
					<div className="flex flex-col gap-1">
						<p className="text-base font-semibold text-foreground">
							{t("settings.general.replayOnboarding.title")}
						</p>
						<p className="text-sm text-muted-foreground">
							{t("settings.general.replayOnboarding.description")}
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
						{t("settings.general.replayOnboarding.action")}
					</Button>
				</div>
				<div className="flex py-4 items-center justify-between gap-5 max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:py-4">
					<div className="flex flex-col gap-1">
						<p className="text-base font-semibold text-foreground">
							{t("settings.general.about.title")}
						</p>
						<p className="text-sm text-muted-foreground">
							{productNameForVersion(appVersion)}
							{appVersion ? ` v${appVersion}` : ""}
							{isBetaVersion(appVersion)
								? t("settings.general.about.betaNote")
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
