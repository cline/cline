import {
	completeClineDeviceAuth,
	listLocalProviders,
	loginLocalProvider,
	ProviderSettingsManager,
	saveLocalProviderOAuthCredentials,
	saveLocalProviderSettings,
	startClineDeviceAuth,
} from "@clinebot/core";
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import open from "open";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isOAuthProvider } from "../../../utils/provider-auth";
import { palette } from "../../palette";

interface ProviderItem {
	id: string;
	name: string;
	models: number | null;
	hasApiKey: boolean;
	hasOAuth: boolean;
	isOAuth: boolean;
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
				setProviders(
					list.map((p) => ({
						id: p.id,
						name: p.name,
						models: p.models,
						hasApiKey: Boolean(p.apiKey),
						hasOAuth: p.oauthAccessTokenPresent === true,
						isOAuth: isOAuthProvider(p.id),
					})),
				);
				const idx = list.findIndex((p) => p.id === currentProviderId);
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
			setSelected((s) => (s <= 0 ? filtered.length - 1 : s - 1));
			return;
		}
		if (key.name === "down") {
			setSelected((s) => (s >= filtered.length - 1 ? 0 : s + 1));
		}
	}, dialogId);

	const halfWindow = Math.floor(MAX_VISIBLE / 2);
	let start = Math.max(0, safeSelected - halfWindow);
	if (start + MAX_VISIBLE > filtered.length) {
		start = Math.max(0, filtered.length - MAX_VISIBLE);
	}
	const visible = filtered.slice(start, start + MAX_VISIBLE);
	const aboveCount = start;
	const belowCount = Math.max(0, filtered.length - start - MAX_VISIBLE);

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
					{aboveCount > 0 && (
						<box paddingX={1} justifyContent="center">
							<text fg="gray">
								{"\u25b2"} {aboveCount} more
							</text>
						</box>
					)}
					{visible.map((p, i) => {
						const absIdx = start + i;
						const isSel = absIdx === safeSelected;
						const isCurrent = p.id === currentProviderId;
						const authed = p.hasApiKey || p.hasOAuth;
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
					{belowCount > 0 && (
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

export function ApiKeyInputContent(
	props: ChoiceContext<boolean> & {
		providerId: string;
		providerName: string;
	},
) {
	const { resolve, dismiss, dialogId, providerId, providerName } = props;
	const [apiKey, setApiKey] = useState("");
	const [error, setError] = useState("");

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			dismiss();
			return;
		}
		if (key.name === "return") {
			const trimmed = apiKey.trim();
			if (!trimmed) {
				setError("API key is required");
				return;
			}
			const manager = new ProviderSettingsManager();
			saveLocalProviderSettings(manager, {
				providerId,
				apiKey: trimmed,
			});
			resolve(true);
		}
	}, dialogId);

	return (
		<box flexDirection="column" paddingX={1} gap={1}>
			<text fg="cyan">
				<strong>{providerName}</strong>
			</text>

			<text fg="gray">Enter your API key</text>

			<box border borderStyle="rounded" borderColor="gray" paddingX={1}>
				<input
					value={apiKey}
					onInput={setApiKey}
					placeholder="sk-..."
					flexGrow={1}
					focused
				/>
			</box>

			{error && <text fg="red">{error}</text>}

			<text fg="gray">
				<em>Enter to save, Esc to go back</em>
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
		const apiBaseUrl = existing?.baseUrl?.trim() || "https://api.cline.bot";

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
