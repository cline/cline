import {
	completeClineDeviceAuth,
	listLocalProviders,
	loginLocalProvider,
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
import { isOAuthProvider } from "../../../utils/provider-auth";
import { palette } from "../../palette";
import { getProviderSection } from "../../utils/provider-sections";
import {
	getSearchableListRowsWindow,
	type SearchableItem,
} from "../searchable-list";

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

export type ExistingProviderAction = "use_existing" | "reconfigure";

export function UseExistingOrReconfigureContent(
	props: ChoiceContext<ExistingProviderAction> & {
		providerName: string;
	},
) {
	const { resolve, dismiss, dialogId, providerName } = props;
	const options: { value: ExistingProviderAction; label: string }[] = [
		{ value: "use_existing", label: "Use existing configuration" },
		{ value: "reconfigure", label: "Configure again" },
	];
	const [selected, setSelected] = useState(0);

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			dismiss();
			return;
		}
		if (key.name === "return" || key.name === "enter") {
			const opt = options[selected];
			if (opt) resolve(opt.value);
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

type ProviderConfigFieldKey = "apiKey" | "baseUrl";

const FIELD_LABELS: Record<ProviderConfigFieldKey, string> = {
	apiKey: "API key",
	baseUrl: "Base URL",
};

const FIELD_PLACEHOLDERS: Record<ProviderConfigFieldKey, string> = {
	apiKey: "sk-...",
	baseUrl: "",
};

export interface ProviderConfigInputFields {
	apiKey?: { defaultValue?: string };
	baseUrl?: { defaultValue?: string };
}

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
		fields,
		providerSettingsManager,
	} = props;

	// Render order: base URL first (when present) so local-server users land
	// on the actionable input. Cloud providers see just `apiKey`.
	const fieldKeys = useMemo<ProviderConfigFieldKey[]>(() => {
		const order: ProviderConfigFieldKey[] = ["baseUrl", "apiKey"];
		return order.filter((key) => fields[key] !== undefined);
	}, [fields]);

	const [apiKey, setApiKey] = useState("");
	const [baseUrl, setBaseUrl] = useState(
		() =>
			providerSettingsManager
				.getProviderSettings(providerId)
				?.baseUrl?.trim() ??
			fields.baseUrl?.defaultValue ??
			"",
	);

	const initialFocus = fieldKeys[0] ?? "apiKey";
	const [focusedField, setFocusedField] =
		useState<ProviderConfigFieldKey>(initialFocus);

	const getValue = (key: ProviderConfigFieldKey): string =>
		key === "apiKey" ? apiKey : baseUrl;
	const setValue = (key: ProviderConfigFieldKey, value: string): void => {
		if (key === "apiKey") setApiKey(value);
		else setBaseUrl(value);
	};

	const submit = () => {
		saveLocalProviderSettings(providerSettingsManager, {
			providerId,
			apiKey: fields.apiKey ? apiKey.trim() : undefined,
			baseUrl: fields.baseUrl ? baseUrl.trim() : undefined,
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
			<text fg="cyan">
				<strong>{providerName}</strong>
			</text>

			{fieldKeys.map((key) => {
				const requirement = fields[key];
				if (!requirement) return null;
				const placeholder =
					key === "baseUrl" && requirement.defaultValue
						? requirement.defaultValue
						: FIELD_PLACEHOLDERS[key];
				return (
					<box key={key} flexDirection="column">
						<text fg="gray">{FIELD_LABELS[key]}</text>
						<box
							border
							borderStyle="rounded"
							borderColor={focusedField === key ? palette.act : "gray"}
							paddingX={1}
						>
							<input
								value={getValue(key)}
								onInput={(v: string) => setValue(key, v)}
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
			<text fg="cyan">
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
					<text fg="cyan" selectable>
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

export function OAuthLoginContent(
	props: ChoiceContext<boolean> & {
		providerId: string;
		providerName: string;
	},
) {
	const { resolve, dismiss, dialogId, providerId, providerName } = props;
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
							providerId as "cline" | "oca" | "openai-codex",
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
			providerId as "cline" | "oca" | "openai-codex",
			existing,
			(url: string) => {
				setAuthUrl(url);
				setStatus("Waiting for authentication in browser...");
				try {
					void open(url, { wait: false }).catch(() => {
						setStatus(
							"Could not open browser automatically. Open the URL below.",
						);
					});
				} catch {
					setStatus(
						"Could not open browser automatically. Open the URL below.",
					);
				}
			},
		)
			.then((credentials) => {
				if (!isActiveAuthAttempt(attempt)) return;
				saveLocalProviderOAuthCredentials(
					manager,
					providerId as "cline" | "oca" | "openai-codex",
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
		}
	}, dialogId);

	if (mode === "device") {
		return (
			<box flexDirection="column" paddingX={1} gap={1}>
				<text fg="cyan">
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
						<text fg="cyan" selectable>
							{deviceVerifyUrl}
						</text>
					</box>
				)}

				{deviceError && <text fg="red">{deviceError}</text>}

				<text fg="gray">
					<em>Esc to cancel</em>
				</text>
			</box>
		);
	}

	return (
		<box flexDirection="column" paddingX={1} gap={1}>
			<text fg="cyan">
				<strong>{providerName}</strong>
			</text>

			<text>{status}</text>

			{authUrl && (
				<text fg="gray" selectable>
					{authUrl}
				</text>
			)}

			{error && <text fg="red">{error}</text>}

			<text fg="gray">
				<em>Esc to cancel</em>
			</text>
		</box>
	);
}
