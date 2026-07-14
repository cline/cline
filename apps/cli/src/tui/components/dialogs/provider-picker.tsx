import {
	completeClineDeviceAuth,
	getProviderConfigFields,
	isOAuthProvider,
	loginLocalProvider,
	type ProviderConfigFieldKey,
	type ProviderConfigFieldRequirement,
	ProviderSettingsManager,
	saveLocalProviderOAuthCredentials,
	saveLocalProviderSettings,
	startClineDeviceAuth,
} from "@cline/core";
import { getClineEnvironmentConfig } from "@cline/shared";
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import open from "open";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	CODEX_CLI_INSTALL_URL,
	type CodexCliStatus,
	checkCodexCliInstalled,
	isOpenAICodexCliProvider,
} from "../../../utils/codex-cli";
import { listLocalProviders } from "../../../utils/provider-catalog";
import { palette } from "../../palette";
import {
	getDefaultAwsRegion,
	type ProviderConfigValues,
	resolveProviderConfigAwsRegion,
	resolveProviderConfigAzure,
	resolveProviderConfigGcp,
	resolveProviderConfigSap,
	updateProviderConfigValue,
} from "../../utils/provider-config-values";
import { getProviderSection } from "../../utils/provider-sections";
import {
	getSearchableListRowsWindow,
	type SearchableItem,
} from "../searchable-list";
import {
	buildClinePassSubscriptionPageUrl,
	saveManualProviderApiKey,
} from "./provider-picker-helpers";

interface ProviderItem {
	id: string;
	name: string;
	models: number | null;
	isConfigured: boolean;
	isOAuth: boolean;
	isLocalAuth: boolean;
	capabilities?: readonly string[];
}

const MAX_VISIBLE = 10;

type AuthAttempt = {
	cancelled: boolean;
};

export function ProviderPickerContent(
	props: ChoiceContext<string> & { currentProviderId: string },
) {
	const { resolve, dismiss, dialogId, currentProviderId } = props;
	const [providers, setProviders] = useState<ProviderItem[]>([]);
	const [search, setSearch] = useState("");
	const [selected, setSelected] = useState(0);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const manager = new ProviderSettingsManager();
		listLocalProviders(manager)
			.then(({ providers: list }) => {
				const providerItems = list.map((p) => ({
					id: p.id,
					name: p.name,
					models: p.models,
					// `enabled` is true whenever the provider has any persisted
					// settings, so keyless local configs (e.g. Ollama saved with
					// just a model id and base URL) still render as configured.
					isConfigured: p.enabled === true,
					isOAuth: isOAuthProvider(p.id),
					isLocalAuth: isOpenAICodexCliProvider(p.id),
					capabilities: p.capabilities,
				}));
				setProviders(providerItems);
				const idx = providerItems.findIndex((p) => p.id === currentProviderId);
				if (idx >= 0) setSelected(idx);
			})
			.catch(() => {})
			.finally(() => setLoading(false));
	}, [currentProviderId]);

	const filtered = useMemo(() => {
		if (!search) return providers;
		const q = search.toLowerCase();
		return providers.filter(
			(p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q),
		);
	}, [providers, search]);

	const safeSelected = Math.min(selected, Math.max(0, filtered.length - 1));
	const rowItems: SearchableItem[] = useMemo(
		() =>
			filtered.map((p) => ({
				key: p.id,
				label: p.name,
				section: getProviderSection(p),
			})),
		[filtered],
	);

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			dismiss();
			return;
		}
		if (key.name === "return") {
			const provider = filtered[safeSelected];
			if (provider) resolve(provider.id);
			return;
		}
		if (key.name === "up") {
			setSelected((s) =>
				filtered.length === 0 ? 0 : s <= 0 ? filtered.length - 1 : s - 1,
			);
			return;
		}
		if (key.name === "down") {
			setSelected((s) =>
				filtered.length === 0 ? 0 : s >= filtered.length - 1 ? 0 : s + 1,
			);
		}
	}, dialogId);

	const { visibleRows, aboveCount, belowCount, showAbove, showBelow } =
		getSearchableListRowsWindow(rowItems, safeSelected, MAX_VISIBLE);

	return (
		<box flexDirection="column" gap={1}>
			<text>Select Provider</text>

			<box border borderStyle="rounded" borderColor="gray" paddingX={1}>
				<input
					onInput={(v: string) => {
						setSearch(v);
						setSelected(0);
					}}
					placeholder="Search providers..."
					flexGrow={1}
					focused
				/>
			</box>

			{loading ? (
				<text fg="gray">Loading providers...</text>
			) : filtered.length === 0 ? (
				<text fg="gray">No providers match</text>
			) : (
				<box flexDirection="column">
					{showAbove && (
						<box paddingX={1} justifyContent="center">
							<text fg="gray">
								{"\u25b2"} {aboveCount} more
							</text>
						</box>
					)}
					{visibleRows.map((row) => {
						if (row.kind === "header") {
							return (
								<box key={row.key} paddingX={1} height={1}>
									<text fg="gray">{row.label}</text>
								</box>
							);
						}
						const p = filtered[row.itemIndex];
						if (!p) return null;
						const isSel = row.itemIndex === safeSelected;
						const isCurrent = p.id === currentProviderId;
						// Configured = any persisted settings exist for this provider,
						// which covers keyless local configs (Ollama / LM Studio with
						// just a model id) as well as api-key and OAuth providers.
						const authed = p.isConfigured;
						return (
							<box
								key={p.id}
								paddingX={1}
								flexDirection="row"
								gap={1}
								backgroundColor={isSel ? palette.selection : undefined}
								overflow="hidden"
								height={1}
							>
								<text
									fg={isSel ? palette.textOnSelection : "gray"}
									flexShrink={0}
								>
									{isSel ? "\u276f" : " "}
								</text>
								<text fg={isSel ? palette.textOnSelection : undefined}>
									{p.name}
								</text>
								{p.isOAuth && (
									<text
										fg={isSel ? palette.textOnSelection : "gray"}
										flexShrink={0}
									>
										(OAuth)
									</text>
								)}
								{p.isLocalAuth && (
									<text
										fg={isSel ? palette.textOnSelection : "gray"}
										flexShrink={0}
									>
										(local CLI)
									</text>
								)}
								{authed && (
									<text
										fg={isSel ? palette.textOnSelection : palette.success}
										flexShrink={0}
									>
										{"\u25cf"}
									</text>
								)}
								{isCurrent && (
									<text
										fg={isSel ? palette.textOnSelection : palette.success}
										flexShrink={0}
									>
										(current)
									</text>
								)}
							</box>
						);
					})}
					{showBelow && (
						<box paddingX={1} justifyContent="center">
							<text fg="gray">
								{"\u25bc"} {belowCount} more
							</text>
						</box>
					)}
				</box>
			)}

			<text fg="gray">
				Type to search, ↑/↓ navigate, Enter to select, Esc to go back
			</text>
		</box>
	);
}

export type ExistingProviderAction =
	| "use_existing"
	| "reconfigure"
	| "open_subscription_page"
	| "open_usage_billing";

export interface ExistingProviderOption {
	value: ExistingProviderAction;
	label: string;
	onSelect?: () => Promise<void> | void;
}

export function UseExistingOrReconfigureContent(
	props: ChoiceContext<ExistingProviderOption> & {
		providerName: string;
		extraOptions?: ExistingProviderOption[];
	},
) {
	const { resolve, dismiss, dialogId, providerName, extraOptions } = props;
	const options: ExistingProviderOption[] = useMemo(
		() => [
			{ value: "use_existing", label: "Use existing configuration" },
			{ value: "reconfigure", label: "Configure again" },
			...(extraOptions ?? []),
		],
		[extraOptions],
	);
	const [selected, setSelected] = useState(0);

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			dismiss();
			return;
		}
		if (key.name === "return" || key.name === "enter") {
			const opt = options[selected];
			if (opt) resolve(opt);
			return;
		}
		if (key.name === "up" || (key.ctrl && key.name === "p")) {
			setSelected((s) => (s <= 0 ? options.length - 1 : s - 1));
			return;
		}
		if (key.name === "down" || (key.ctrl && key.name === "n")) {
			setSelected((s) => (s >= options.length - 1 ? 0 : s + 1));
		}
	}, dialogId);

	return (
		<box flexDirection="column" gap={1}>
			<text>
				<strong>{providerName}</strong> is already configured
			</text>

			<box flexDirection="column">
				{options.map((opt, i) => (
					<box
						key={opt.value}
						paddingX={1}
						flexDirection="row"
						gap={1}
						backgroundColor={i === selected ? palette.selection : undefined}
					>
						<text
							fg={i === selected ? palette.textOnSelection : "gray"}
							flexShrink={0}
						>
							{i === selected ? "❯" : " "}
						</text>
						<text fg={i === selected ? palette.textOnSelection : undefined}>
							{opt.label}
						</text>
					</box>
				))}
			</box>

			<text fg="gray">↑/↓ navigate, Enter to select, Esc to go back</text>
		</box>
	);
}

function ClinePassBrowserPageContent(
	props: ChoiceContext<boolean> & {
		providerName: string;
		pageLabel: string;
		url: string;
		openedStatus: string;
	},
) {
	const {
		resolve,
		dismiss,
		dialogId,
		providerName,
		pageLabel,
		url,
		openedStatus,
	} = props;
	const [status, setStatus] = useState("Opening browser...");

	useEffect(() => {
		void open(url, { wait: false })
			.then(() => {
				setStatus(openedStatus);
			})
			.catch(() => {
				setStatus("Could not open browser automatically. Open the URL below.");
			});
	}, [url, openedStatus]);

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			dismiss();
			return;
		}
		if (key.name === "return" || key.name === "enter") {
			resolve(true);
		}
	}, dialogId);

	return (
		<box flexDirection="column" paddingX={1} gap={1}>
			<text fg={palette.act}>
				<strong>{providerName}</strong>
			</text>

			<text>{status}</text>

			<text fg="gray">{pageLabel}:</text>
			<text fg={palette.act} selectable>
				<a href={url}>{url}</a>
			</text>

			<text fg="gray">
				<em>Enter or Esc to go back</em>
			</text>
		</box>
	);
}

export function ClinePassSubscriptionContent(
	props: ChoiceContext<boolean> & {
		providerName: string;
	},
) {
	const subscriptionUrl = useMemo(
		() =>
			buildClinePassSubscriptionPageUrl(getClineEnvironmentConfig().appBaseUrl),
		[],
	);

	return (
		<ClinePassBrowserPageContent
			{...props}
			pageLabel="Subscription page"
			url={subscriptionUrl}
			openedStatus="Opened subscription page in your browser."
		/>
	);
}

const DEFAULT_FIELD_LABELS: Partial<Record<ProviderConfigFieldKey, string>> = {
	apiKey: "API key",
	baseUrl: "Base URL",
	azureApiVersion: "Azure API Version",
	awsRegion: "AWS Region",
	awsProfile: "AWS Profile Name",
	gcpProjectId: "Google Cloud Project ID",
	gcpRegion: "Google Cloud Region",
	sapClientId: "Client ID",
	sapClientSecret: "Client Secret",
	sapTokenUrl: "Token URL",
	sapResourceGroup: "Resource Group",
	sapDeploymentId: "Deployment ID",
};

const DEFAULT_FIELD_PLACEHOLDERS: Partial<
	Record<ProviderConfigFieldKey, string>
> = {
	apiKey: "sk-...",
	baseUrl: "",
	azureApiVersion: "2025-01-01-preview",
	awsRegion: "us-east-1",
	awsProfile: "default",
	gcpProjectId: "my-gcp-project",
	gcpRegion: "us-central1",
	sapClientId: "sb-...|xsuaa_std!b...",
	sapClientSecret: "SAP AI Core client secret",
	sapTokenUrl: "https://<subdomain>.authentication.sap.hana.ondemand.com",
	sapResourceGroup: "default",
	sapDeploymentId: "",
};

/** Render order for cycling focus with Tab. */
const FIELD_ORDER: ProviderConfigFieldKey[] = [
	"awsRegion",
	"gcpProjectId",
	"gcpRegion",
	"baseUrl",
	"azureApiVersion",
	"apiKey",
	"awsProfile",
	"sapClientId",
	"sapClientSecret",
	"sapTokenUrl",
	"sapResourceGroup",
	"sapDeploymentId",
];

export type ProviderConfigInputFields = Partial<
	Record<ProviderConfigFieldKey, ProviderConfigFieldRequirement>
>;

/**
 * Single-purpose configure dialog: collects API key and (when applicable)
 * base URL. Model selection happens separately in the standard model picker
 * after this dialog resolves. No fields are required. The dialog accepts
 * blanks. If credentials are missing or wrong, the API call surfaces the
 * provider's own error to the user.
 */
export function ProviderConfigInputContent(
	props: ChoiceContext<boolean> & {
		providerId: string;
		providerName: string;
		fields: ProviderConfigInputFields;
		providerSettingsManager: ProviderSettingsManager;
	},
) {
	const {
		resolve,
		dismiss,
		dialogId,
		providerId,
		providerName,
		providerSettingsManager,
	} = props;

	const config = useMemo(
		() => getProviderConfigFields(providerId),
		[providerId],
	);
	const fieldKeys = useMemo<ProviderConfigFieldKey[]>(
		() => FIELD_ORDER.filter((key) => config.fields[key] !== undefined),
		[config],
	);

	const existingSettings =
		providerSettingsManager.getProviderSettings(providerId);
	const [values, setValues] = useState<ProviderConfigValues>(() => {
		const initial: ProviderConfigValues = {};
		if (config.fields.baseUrl) {
			initial.baseUrl =
				existingSettings?.baseUrl?.trim() ??
				config.fields.baseUrl?.defaultValue ??
				"";
		}
		if (config.fields.azureApiVersion) {
			initial.azureApiVersion =
				existingSettings?.azure?.apiVersion?.trim() ?? "";
		}
		if (config.fields.awsRegion) {
			const ep = existingSettings?.aws?.profile?.trim() ?? "";
			initial.awsRegion =
				existingSettings?.aws?.region?.trim() || getDefaultAwsRegion(ep);
		}
		if (config.fields.gcpProjectId)
			initial.gcpProjectId = existingSettings?.gcp?.projectId?.trim() ?? "";
		if (config.fields.gcpRegion)
			initial.gcpRegion =
				existingSettings?.gcp?.region?.trim() ??
				config.fields.gcpRegion.defaultValue ??
				"us-central1";
		if (config.fields.apiKey)
			initial.apiKey = existingSettings?.apiKey?.trim() ?? "";
		if (config.fields.awsProfile)
			initial.awsProfile = existingSettings?.aws?.profile?.trim() ?? "";
		if (config.fields.sapClientId)
			initial.sapClientId = existingSettings?.sap?.clientId?.trim() ?? "";
		if (config.fields.sapClientSecret)
			initial.sapClientSecret =
				existingSettings?.sap?.clientSecret?.trim() ?? "";
		if (config.fields.sapTokenUrl)
			initial.sapTokenUrl = existingSettings?.sap?.tokenUrl?.trim() ?? "";
		if (config.fields.sapResourceGroup)
			initial.sapResourceGroup =
				existingSettings?.sap?.resourceGroup?.trim() ?? "default";
		if (config.fields.sapDeploymentId)
			initial.sapDeploymentId =
				existingSettings?.sap?.deploymentId?.trim() ?? "";
		return initial;
	});

	const [focusedField, setFocusedField] = useState<ProviderConfigFieldKey>(
		() => fieldKeys[0] ?? "apiKey",
	);

	const submit = () => {
		const apiKey = values.apiKey?.trim();
		const awsProfile = values.awsProfile?.trim();
		const hasAzureFields = config.fields.azureApiVersion;
		const hasAwsFields = config.fields.awsRegion || config.fields.awsProfile;
		const hasGcpFields = config.fields.gcpProjectId || config.fields.gcpRegion;
		const hasSapFields =
			config.fields.sapClientId ||
			config.fields.sapClientSecret ||
			config.fields.sapTokenUrl ||
			config.fields.sapResourceGroup ||
			config.fields.sapDeploymentId;
		saveLocalProviderSettings(providerSettingsManager, {
			providerId,
			apiKey: config.fields.apiKey ? apiKey : undefined,
			baseUrl: config.fields.baseUrl ? values.baseUrl?.trim() : undefined,
			azure: hasAzureFields ? resolveProviderConfigAzure(values) : undefined,
			aws: hasAwsFields
				? {
						region: resolveProviderConfigAwsRegion(values),
						authentication: apiKey ? "api-key" : "profile",
						profile: apiKey ? undefined : awsProfile || undefined,
					}
				: undefined,
			gcp: hasGcpFields ? resolveProviderConfigGcp(values) : undefined,
			sap: hasSapFields ? resolveProviderConfigSap(values) : undefined,
		});
		resolve(true);
	};

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			dismiss();
			return;
		}
		if (key.name === "return") {
			submit();
			return;
		}
		if (key.name === "tab" && fieldKeys.length > 1) {
			const idx = fieldKeys.indexOf(focusedField);
			const nextIdx = key.shift
				? (idx - 1 + fieldKeys.length) % fieldKeys.length
				: (idx + 1) % fieldKeys.length;
			const next = fieldKeys[nextIdx];
			if (next) setFocusedField(next);
		}
	}, dialogId);

	return (
		<box flexDirection="column" paddingX={1} gap={1}>
			<text fg={palette.act}>
				<strong>{providerName}</strong>
			</text>

			{config.description && <text fg="gray">{config.description}</text>}

			{fieldKeys.map((key) => {
				const requirement = config.fields[key];
				if (!requirement) return null;
				const label = requirement.label ?? DEFAULT_FIELD_LABELS[key] ?? key;
				const placeholder =
					requirement.placeholder ??
					(key === "baseUrl" && requirement.defaultValue
						? requirement.defaultValue
						: (DEFAULT_FIELD_PLACEHOLDERS[key] ?? ""));
				return (
					<box key={key} flexDirection="column">
						<text fg="gray">{label}</text>
						{requirement.note && <text fg="gray">{requirement.note}</text>}
						<box
							border
							borderStyle="rounded"
							borderColor={focusedField === key ? palette.act : "gray"}
							paddingX={1}
						>
							<input
								value={values[key] ?? ""}
								onInput={(v: string) =>
									setValues((prev) => updateProviderConfigValue(prev, key, v))
								}
								placeholder={placeholder}
								flexGrow={1}
								focused={focusedField === key}
							/>
						</box>
					</box>
				);
			})}

			<text fg="gray">
				<em>
					{fieldKeys.length > 1
						? "Tab to switch fields, Enter to save, Esc to go back"
						: "Enter to save, Esc to go back"}
				</em>
			</text>
		</box>
	);
}

export function CodexCliStatusContent(
	props: ChoiceContext<boolean> & {
		providerName: string;
	},
) {
	const { resolve, dismiss, dialogId, providerName } = props;
	const [status, setStatus] = useState<CodexCliStatus | undefined>();
	const [checking, setChecking] = useState(false);

	const refresh = useCallback(() => {
		setStatus(undefined);
		setChecking(true);
		checkCodexCliInstalled()
			.then(setStatus)
			.catch((error: unknown) => {
				setStatus({
					installed: false,
					reason: error instanceof Error ? error.message : String(error),
				});
			})
			.finally(() => setChecking(false));
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			dismiss();
			return;
		}
		if (key.name === "r") {
			refresh();
			return;
		}
		if (key.name === "return" && status?.installed) {
			resolve(true);
		}
	}, dialogId);

	return (
		<box flexDirection="column" paddingX={1} gap={1}>
			<text fg={palette.act}>
				<strong>{providerName}</strong>
			</text>

			{checking && <text fg="gray">Checking for Codex CLI...</text>}

			{status?.installed && (
				<box flexDirection="column" gap={1}>
					<text fg={palette.success}>{"\u25cf"} Codex CLI installed</text>
					<text fg="gray">{status.version}</text>
				</box>
			)}

			{status && !status.installed && (
				<box flexDirection="column" gap={1}>
					<text fg="yellow">Codex CLI was not found</text>
					<text fg="gray">{status.reason}</text>
					<text fg="gray">Install Codex CLI from:</text>
					<text fg={palette.act} selectable>
						{CODEX_CLI_INSTALL_URL}
					</text>
				</box>
			)}

			<text fg="gray">
				<em>
					{status?.installed
						? "Enter to continue, R to recheck, Esc to go back"
						: "R to recheck, Esc to go back"}
				</em>
			</text>
		</box>
	);
}

/**
 * Resolves `true` on successful login, `"use_api_key"` when the user opts
 * into manual API key entry (only offered with `allowApiKeyFallback`).
 */
export type OAuthLoginResult = boolean | "use_api_key";

export function OAuthLoginContent(
	props: ChoiceContext<OAuthLoginResult> & {
		providerId: string;
		providerName: string;
		allowApiKeyFallback?: boolean;
	},
) {
	const {
		resolve,
		dismiss,
		dialogId,
		providerId,
		providerName,
		allowApiKeyFallback,
	} = props;
	const [mode, setMode] = useState<"browser" | "device">(
		providerId === "cline" ? "device" : "browser",
	);
	const [status, setStatus] = useState("Opening browser...");
	const [authUrl, setAuthUrl] = useState("");
	const [error, setError] = useState("");
	const [deviceUserCode, setDeviceUserCode] = useState("");
	const [deviceVerifyUrl, setDeviceVerifyUrl] = useState("");
	const [deviceError, setDeviceError] = useState("");
	const activeAuthAttemptRef = useRef<AuthAttempt | undefined>(undefined);

	const startAuthAttempt = useCallback(() => {
		const attempt: AuthAttempt = { cancelled: false };
		activeAuthAttemptRef.current = attempt;
		return attempt;
	}, []);

	const cancelAuthAttempt = useCallback(() => {
		const attempt = activeAuthAttemptRef.current;
		if (attempt) {
			attempt.cancelled = true;
		}
		activeAuthAttemptRef.current = undefined;
	}, []);

	const isActiveAuthAttempt = useCallback((attempt: AuthAttempt) => {
		return activeAuthAttemptRef.current === attempt && !attempt.cancelled;
	}, []);

	const startDeviceAuthCodeFlow = useCallback(() => {
		cancelAuthAttempt();
		const attempt = startAuthAttempt();
		setMode("device");
		setError("");
		setDeviceUserCode("");
		setDeviceVerifyUrl("");
		setDeviceError("");

		const manager = new ProviderSettingsManager();
		const existing = manager.getProviderSettings(providerId);
		const apiBaseUrl =
			existing?.baseUrl?.trim() || getClineEnvironmentConfig().apiBaseUrl;

		startClineDeviceAuth()
			.then((result) => {
				if (!isActiveAuthAttempt(attempt)) return;
				setDeviceUserCode(result.userCode);
				setDeviceVerifyUrl(
					result.verificationUriComplete || result.verificationUri,
				);

				completeClineDeviceAuth({
					deviceCode: result.deviceCode,
					expiresInSeconds: result.expiresInSeconds,
					pollIntervalSeconds: result.pollIntervalSeconds,
					apiBaseUrl,
					provider: providerId,
				})
					.then((credentials) => {
						if (!isActiveAuthAttempt(attempt)) return;
						saveLocalProviderOAuthCredentials(
							manager,
							providerId,
							existing,
							credentials,
						);
						resolve(true);
					})
					.catch((err: unknown) => {
						if (!isActiveAuthAttempt(attempt)) return;
						setDeviceError(err instanceof Error ? err.message : String(err));
					});
			})
			.catch((err: unknown) => {
				if (!isActiveAuthAttempt(attempt)) return;
				setDeviceError(err instanceof Error ? err.message : String(err));
			});
	}, [
		providerId,
		resolve,
		startAuthAttempt,
		isActiveAuthAttempt,
		cancelAuthAttempt,
	]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
	useEffect(() => {
		if (providerId === "cline") {
			startDeviceAuthCodeFlow();
			return cancelAuthAttempt;
		}

		const attempt = startAuthAttempt();
		const manager = new ProviderSettingsManager();
		const existing = manager.getProviderSettings(providerId);

		loginLocalProvider(
			providerId,
			existing,
			(url: string, instructions?: string) => {
				setAuthUrl(url);
				setStatus(instructions ?? "Waiting for authentication in browser...");
				try {
					void open(url, { wait: false }).catch(() => {
						setStatus(
							instructions
								? `${instructions} Browser did not open automatically.`
								: "Could not open browser automatically. Open the URL below.",
						);
					});
				} catch {
					setStatus(
						instructions
							? `${instructions} Browser did not open automatically.`
							: "Could not open browser automatically. Open the URL below.",
					);
				}
			},
		)
			.then((credentials) => {
				if (!isActiveAuthAttempt(attempt)) return;
				saveLocalProviderOAuthCredentials(
					manager,
					providerId,
					existing,
					credentials,
				);
				resolve(true);
			})
			.catch((err: unknown) => {
				if (!isActiveAuthAttempt(attempt)) return;
				const msg = err instanceof Error ? err.message : String(err);
				setError(msg);
				setStatus("Authentication failed");
			});
		return cancelAuthAttempt;
	}, []);

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			cancelAuthAttempt();
			dismiss();
			return;
		}
		if (key.name === "k" && allowApiKeyFallback) {
			cancelAuthAttempt();
			resolve("use_api_key");
		}
	}, dialogId);

	const escapeHint = allowApiKeyFallback
		? "K to enter an API key instead, Esc to cancel"
		: "Esc to cancel";

	if (mode === "device") {
		return (
			<box flexDirection="column" paddingX={1} gap={1}>
				<text fg={palette.act}>
					<strong>{providerName}</strong>
				</text>

				{!deviceUserCode && !deviceError && (
					<text fg="gray">Requesting device code...</text>
				)}

				{deviceUserCode && !deviceError && (
					<box flexDirection="column" gap={1}>
						<text fg="gray">Your code:</text>
						<text fg="white" selectable>
							<strong>{deviceUserCode}</strong>
						</text>
						<text fg="gray">Visit this URL and enter the code above:</text>
						<text fg={palette.act} selectable>
							<a href={deviceVerifyUrl}>{deviceVerifyUrl}</a>
						</text>
					</box>
				)}

				{deviceError && <text fg="red">{deviceError}</text>}

				<text fg="gray">
					<em>{escapeHint}</em>
				</text>
			</box>
		);
	}

	return (
		<box flexDirection="column" paddingX={1} gap={1}>
			<text fg={palette.act}>
				<strong>{providerName}</strong>
			</text>

			<text>{status}</text>

			{authUrl && (
				<text fg="gray" selectable>
					<a href={authUrl}>{authUrl}</a>
				</text>
			)}

			{error && <text fg="red">{error}</text>}

			<text fg="gray">
				<em>{escapeHint}</em>
			</text>
		</box>
	);
}

/**
 * Manual API key entry for OAuth-capable providers — the escape hatch for
 * when OAuth login isn't working. Saving clears any stored OAuth tokens so
 * the manual key takes effect (see saveManualProviderApiKey).
 */
export function OAuthApiKeyInputContent(
	props: ChoiceContext<boolean> & {
		providerId: string;
		providerName: string;
		providerSettingsManager: ProviderSettingsManager;
	},
) {
	const {
		resolve,
		dismiss,
		dialogId,
		providerId,
		providerName,
		providerSettingsManager,
	} = props;
	const [value, setValue] = useState("");

	const submit = () => {
		const apiKey = value.trim();
		if (!apiKey) return;
		saveManualProviderApiKey(providerSettingsManager, providerId, apiKey);
		resolve(true);
	};

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			dismiss();
			return;
		}
		if (key.name === "return") {
			submit();
		}
	}, dialogId);

	return (
		<box flexDirection="column" paddingX={1} gap={1}>
			<text fg={palette.act}>
				<strong>{providerName}</strong>
			</text>

			<text fg="gray">
				Use an API key from your Cline dashboard instead of OAuth login. This
				replaces any saved login tokens.
			</text>

			<box flexDirection="column">
				<text fg="gray">API key</text>
				<box
					border
					borderStyle="rounded"
					borderColor={palette.act}
					paddingX={1}
				>
					<input
						value={value}
						onInput={setValue}
						placeholder="Paste your API key"
						flexGrow={1}
						focused
					/>
				</box>
			</box>

			<text fg="gray">
				<em>Enter to save, Esc to go back</em>
			</text>
		</box>
	);
}
