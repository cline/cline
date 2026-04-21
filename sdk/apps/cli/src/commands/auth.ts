import { createInterface } from "node:readline";
import {
	createOAuthClientCallbacks,
	deleteLocalProvider,
	ensureCustomProvidersLoaded,
	listLocalProviders,
	type ProviderSettings,
	type ProviderSettingsManager,
	saveLocalProviderSettings,
} from "@clinebot/core";
import { Command } from "commander";
import { Box, render, Text, useApp, useInput } from "ink";
import open from "open";
import React, { useEffect, useMemo, useState } from "react";
import {
	getPersistedProviderApiKey,
	isOAuthProvider,
	normalizeAuthProviderId,
	normalizeProviderId,
	type OAuthCredentials,
	toProviderApiKey,
} from "../utils/provider-auth";

export {
	getPersistedProviderApiKey,
	isOAuthProvider,
	normalizeAuthProviderId,
	normalizeProviderId,
	toProviderApiKey,
};
export type { OAuthCredentials };

const c = {
	reset: "\x1b[0m",
	dim: "\x1b[2m",
	cyan: "\x1b[36m",
	green: "\x1b[32m",
};

type CoreOAuthApi = {
	loginClineOAuth: (input: {
		apiBaseUrl: string;
		callbacks: {
			onAuth: (info: { url: string; instructions?: string }) => void;
			onPrompt: (prompt: {
				message: string;
				defaultValue?: string;
			}) => Promise<string>;
			onManualCodeInput?: () => Promise<string>;
		};
	}) => Promise<OAuthCredentials>;
	loginOcaOAuth: (input: {
		mode?: "internal" | "external";
		callbacks: {
			onAuth: (info: { url: string; instructions?: string }) => void;
			onPrompt: (prompt: {
				message: string;
				defaultValue?: string;
			}) => Promise<string>;
			onManualCodeInput?: () => Promise<string>;
		};
	}) => Promise<OAuthCredentials>;
	loginOpenAICodex: (input: {
		onAuth: (info: { url: string; instructions?: string }) => void;
		onPrompt: (prompt: {
			message: string;
			defaultValue?: string;
		}) => Promise<string>;
		onManualCodeInput?: () => Promise<string>;
	}) => Promise<OAuthCredentials>;
};

type AuthIo = {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
};

type AuthQuickSetupInput = {
	provider: string;
	apikey: string;
	modelid: string;
	baseurl?: string;
};

type AuthCommandInput = {
	providerSettingsManager: ProviderSettingsManager;
	io: AuthIo;
	explicitProvider?: string;
	apikey?: string;
	modelid?: string;
	baseurl?: string;
};

type ParsedAuthCommandArgs = {
	explicitProvider?: string;
	apikey?: string;
	modelid?: string;
	baseurl?: string;
	parseError?: string;
};

let cachedCoreOAuthApi: Promise<CoreOAuthApi> | undefined;

async function getCoreOAuthApi(): Promise<CoreOAuthApi> {
	if (!cachedCoreOAuthApi) {
		cachedCoreOAuthApi = import("@clinebot/core").then((module) => {
			const runtimeApi = module as Partial<CoreOAuthApi>;
			if (
				typeof runtimeApi.loginClineOAuth !== "function" ||
				typeof runtimeApi.loginOcaOAuth !== "function" ||
				typeof runtimeApi.loginOpenAICodex !== "function"
			) {
				throw new Error(
					"Installed @clinebot/core does not expose OAuth login helpers required by the CLI",
				);
			}
			return runtimeApi as CoreOAuthApi;
		});
	}
	return cachedCoreOAuthApi;
}

/**
 * Create the `auth` subcommand for Commander.
 *
 * In the auth context, `-p` means `--provider` and `-m` means `--modelid`,
 * which intentionally shadows the global `-p` (--plan) and `-m` (--model)
 * short flags. Commander scopes options per-command, so there is no conflict.
 */
export function createAuthCommand(): Command {
	const cmd = new Command("auth")
		.description("Authenticate with an LLM provider")
		.exitOverride()
		.configureOutput({ writeOut: () => {}, writeErr: () => {} })
		.argument("[provider]", "provider id (positional shorthand for -p)")
		.option("-p, --provider <id>", "provider id")
		.option("-k, --apikey <key>", "API key")
		.option("-m, --modelid <id>", "model id")
		.option("-b, --baseurl <url>", "base URL");
	return cmd;
}

export function parseAuthCommandArgs(args: string[]): ParsedAuthCommandArgs {
	const cmd = createAuthCommand();
	try {
		cmd.parse(args, { from: "user" });
	} catch {
		// Commander throws on --help / --version / unknown flags via exitOverride
		return { parseError: `unknown auth option in: ${args.join(" ")}` };
	}
	const opts = cmd.opts<{
		provider?: string;
		apikey?: string;
		modelid?: string;
		baseurl?: string;
	}>();
	const positionalProvider = cmd.args[0];
	return {
		explicitProvider: opts.provider ?? positionalProvider,
		apikey: opts.apikey,
		modelid: opts.modelid,
		baseurl: opts.baseurl,
	};
}

async function loadProviderCatalog(
	providerSettingsManager: ProviderSettingsManager,
): Promise<Array<{ id: string; name: string }>> {
	await ensureCustomProvidersLoaded(providerSettingsManager);
	const catalog = await listLocalProviders(providerSettingsManager);
	return catalog.providers
		.map((provider) => ({
			id: provider.id.trim(),
			name: provider.name.trim() || provider.id.trim(),
		}))
		.filter((provider) => provider.id.length > 0)
		.sort((a, b) => a.id.localeCompare(b.id));
}

function toProviderLabels(
	providers: Array<{ id: string; name: string }>,
): string[] {
	return providers.map((provider) => `${provider.name} (${provider.id})`);
}

async function deleteProviderFromAuth(
	providerSettingsManager: ProviderSettingsManager,
	providerId: string,
): Promise<void> {
	try {
		await deleteLocalProvider(providerSettingsManager, { providerId });
		return;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!message.includes("does not exist")) {
			throw error;
		}
	}
	saveLocalProviderSettings(providerSettingsManager, {
		providerId,
		enabled: false,
	});
}

async function ensureQuickSetupInputValid(
	input: AuthQuickSetupInput,
	providerSettingsManager: ProviderSettingsManager,
): Promise<string | undefined> {
	const normalizedProvider = normalizeProviderId(input.provider);
	const providerCatalog = await loadProviderCatalog(providerSettingsManager);
	if (!providerCatalog.some((provider) => provider.id === normalizedProvider)) {
		return `invalid provider "${input.provider}"`;
	}
	if (!input.apikey.trim()) {
		return "auth quick setup requires --apikey <key>";
	}
	if (!input.modelid.trim()) {
		return "auth quick setup requires --modelid <id>";
	}
	if (
		input.baseurl?.trim() &&
		normalizedProvider !== "openai" &&
		normalizedProvider !== "openai-native"
	) {
		return "base URL is only supported for OpenAI and OpenAI-compatible providers";
	}
	return undefined;
}

function saveQuickAuthProviderSettings(input: {
	providerSettingsManager: ProviderSettingsManager;
	providerId: string;
	apikey: string;
	modelid: string;
	baseurl?: string;
}): void {
	const existing = input.providerSettingsManager.getProviderSettings(
		input.providerId,
	);
	const nextSettings: ProviderSettings = {
		...(existing ?? {
			provider: input.providerId as ProviderSettings["provider"],
		}),
		provider: input.providerId as ProviderSettings["provider"],
		apiKey: input.apikey,
		model: input.modelid,
	};
	if (input.baseurl?.trim()) {
		nextSettings.baseUrl = input.baseurl.trim();
	}
	input.providerSettingsManager.saveProviderSettings(nextSettings);
}

async function askForInputInTerminal(question: string): Promise<string> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new Error("OAuth login requires an interactive terminal session");
	}

	return new Promise<string>((resolve) => {
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		rl.question(`${question} `, (value) => {
			rl.close();
			resolve(value);
		});
	});
}

function createOAuthCallbacks(io: AuthIo): {
	onAuth: (info: { url: string; instructions?: string }) => void;
	onPrompt: (prompt: {
		message: string;
		defaultValue?: string;
	}) => Promise<string>;
} {
	return createOAuthClientCallbacks({
		onPrompt: ({ message, defaultValue }) =>
			askForInputInTerminal(message).then((value) => {
				const trimmed = value.trim();
				return trimmed || defaultValue || "";
			}),
		onOutput: (message) => {
			io.writeln(`${c.dim}[auth] ${message}${c.reset}`);
		},
		openUrl: (url) => open(url, { wait: false }).then(() => undefined),
		onOpenUrlError: ({ error }) => {
			io.writeln(
				`${c.dim}[auth] Could not open browser automatically; open the URL above manually.${c.reset}`,
			);
			io.writeErr(error instanceof Error ? error.message : String(error));
		},
	});
}

async function loginWithOAuthProvider(
	providerId: string,
	existing: ProviderSettings | undefined,
	io: AuthIo,
): Promise<OAuthCredentials> {
	const oauthApi = await getCoreOAuthApi();
	const callbacks = createOAuthCallbacks(io);

	if (providerId === "cline") {
		return oauthApi.loginClineOAuth({
			apiBaseUrl: existing?.baseUrl?.trim() || "https://api.cline.bot",
			callbacks,
		});
	}

	if (providerId === "oca") {
		const mode = existing?.oca?.mode;
		return oauthApi.loginOcaOAuth({
			mode,
			callbacks,
		});
	}

	if (providerId === "openai-codex") {
		return oauthApi.loginOpenAICodex(callbacks);
	}

	throw new Error(
		`Provider "${providerId}" does not support CLI OAuth flow (supported: cline, openai-codex, oca)`,
	);
}

export function saveOAuthProviderSettings(
	providerSettingsManager: ProviderSettingsManager,
	providerId: string,
	existing: ProviderSettings | undefined,
	credentials: OAuthCredentials,
): ProviderSettings {
	const auth = {
		...(existing?.auth ?? {}),
		accessToken: toProviderApiKey(providerId, credentials),
		refreshToken: credentials.refresh,
		accountId: credentials.accountId,
	} as ProviderSettings["auth"] & { expiresAt?: number };
	auth.expiresAt = credentials.expires;
	const merged: ProviderSettings = {
		...(existing ?? {
			provider: providerId as ProviderSettings["provider"],
		}),
		provider: providerId as ProviderSettings["provider"],
		auth,
	};
	providerSettingsManager.saveProviderSettings(merged, {
		tokenSource: "oauth",
	});
	return merged;
}

export async function ensureOAuthProviderApiKey(input: {
	providerId: string;
	currentApiKey?: string;
	existingSettings?: ProviderSettings;
	providerSettingsManager: ProviderSettingsManager;
	io: AuthIo;
}): Promise<{
	apiKey?: string;
	selectedProviderSettings?: ProviderSettings;
}> {
	if (input.currentApiKey || !isOAuthProvider(input.providerId)) {
		return {
			apiKey: input.currentApiKey,
			selectedProviderSettings: input.existingSettings,
		};
	}
	const credentials = await loginWithOAuthProvider(
		input.providerId,
		input.existingSettings,
		input.io,
	);
	const selectedProviderSettings = saveOAuthProviderSettings(
		input.providerSettingsManager,
		input.providerId,
		input.existingSettings,
		credentials,
	);
	return {
		apiKey: toProviderApiKey(input.providerId, credentials),
		selectedProviderSettings,
	};
}

async function runQuickAuthSetup(input: AuthCommandInput): Promise<number> {
	const providerId = normalizeProviderId((input.explicitProvider ?? "").trim());
	const apikey = input.apikey?.trim() ?? "";
	const modelid = input.modelid?.trim() ?? "";
	const baseurl = input.baseurl?.trim();
	const validationError = await ensureQuickSetupInputValid(
		{
			provider: providerId,
			apikey,
			modelid,
			baseurl,
		},
		input.providerSettingsManager,
	);
	if (validationError) {
		input.io.writeErr(validationError);
		return 1;
	}
	saveQuickAuthProviderSettings({
		providerSettingsManager: input.providerSettingsManager,
		providerId,
		apikey,
		modelid,
		baseurl,
	});
	input.io.writeln(
		`${c.green}Provider configured:${c.reset} ${c.cyan}${providerId}${c.reset} (${modelid})`,
	);
	return 0;
}

type InteractiveAuthState = {
	screen:
		| "menu"
		| "provider"
		| "confirm-delete-provider"
		| "apikey"
		| "modelid"
		| "baseurl"
		| "done";
	menuIndex: number;
	providerIndex: number;
	providerIds: string[];
	providerLabels: string[];
	selectedProvider: string;
	providerPendingDelete?: string;
	apiKey: string;
	modelId: string;
	baseUrl: string;
	exitCode: number;
	busy: boolean;
	busyMessage?: string;
	errorMessage?: string;
};

const AUTH_MENU_ITEMS = [
	{ label: "Sign in with Cline", value: "oauth-cline" as const },
	{
		label: "Sign in with ChatGPT Subscription",
		value: "oauth-openai-codex" as const,
	},
	{ label: "Sign in with OCA", value: "oauth-oca" as const },
	{ label: "Use your own API key", value: "byokey" as const },
	{ label: "Exit", value: "exit" as const },
];

function renderSelectableList(input: {
	items: string[];
	selected: number;
	title: string;
}): React.ReactElement {
	return React.createElement(
		Box,
		{ flexDirection: "column", marginBottom: 1 },
		React.createElement(Text, { color: "cyan", bold: true }, input.title),
		...input.items.map((item, index) =>
			React.createElement(
				Text,
				{
					color: index === input.selected ? "blue" : undefined,
					key: `${index}:${item}`,
				},
				`${index === input.selected ? "❯" : " "} ${item}`,
			),
		),
		React.createElement(
			Text,
			{ color: "gray" },
			"Use arrow keys to navigate, Enter to select",
		),
	);
}

function renderPromptInput(input: {
	title: string;
	value: string;
	placeholder?: string;
	secret?: boolean;
}): React.ReactElement {
	const display = input.secret ? "•".repeat(input.value.length) : input.value;
	return React.createElement(
		Box,
		{ flexDirection: "column", marginBottom: 1 },
		React.createElement(Text, { color: "cyan", bold: true }, input.title),
		React.createElement(
			Box,
			null,
			React.createElement(
				Text,
				{ color: display ? "white" : "gray" },
				display || input.placeholder || "",
			),
			React.createElement(Text, { inverse: true }, " "),
		),
		React.createElement(
			Text,
			{ color: "gray" },
			"Enter to continue, Esc to go back",
		),
	);
}

async function runInteractiveAuthTui(input: AuthCommandInput): Promise<number> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		input.io.writeErr(
			"interactive auth setup requires a TTY (use --provider/--apikey/--modelid for non-interactive setup)",
		);
		return 1;
	}
	const providerCatalog = await loadProviderCatalog(
		input.providerSettingsManager,
	);
	const providerIds = providerCatalog.map((provider) => provider.id);
	const providerLabels = toProviderLabels(providerCatalog);
	const defaultProvider =
		normalizeProviderId(
			input.providerSettingsManager.getLastUsedProviderSettings()?.provider ??
				"cline",
		) || "cline";

	const initialProviderIndex = Math.max(
		0,
		providerIds.indexOf(defaultProvider),
	);

	return await new Promise<number>((resolve) => {
		function AuthTui(props: {
			onDone: (code: number) => void;
		}): React.ReactElement {
			const { exit } = useApp();
			const [state, setState] = useState<InteractiveAuthState>({
				screen: "menu",
				menuIndex: 0,
				providerIndex: initialProviderIndex,
				providerIds,
				providerLabels,
				selectedProvider: providerIds[initialProviderIndex] ?? "anthropic",
				apiKey: "",
				modelId: "",
				baseUrl: "",
				exitCode: 0,
				busy: false,
			});

			const currentProvider = useMemo(
				() => state.providerIds[state.providerIndex] ?? state.selectedProvider,
				[state.providerIds, state.providerIndex, state.selectedProvider],
			);

			const finalize = (code: number) => {
				setState((prev) => ({ ...prev, screen: "done", exitCode: code }));
			};

			useInput((value, key) => {
				if (state.screen === "done") {
					return;
				}
				if (state.busy) {
					if (key.ctrl && value === "c") {
						finalize(1);
					}
					return;
				}
				if (key.ctrl && value === "c") {
					finalize(1);
					return;
				}
				if (state.screen === "menu") {
					if (key.upArrow) {
						setState((prev) => ({
							...prev,
							menuIndex:
								prev.menuIndex > 0
									? prev.menuIndex - 1
									: AUTH_MENU_ITEMS.length - 1,
						}));
						return;
					}
					if (key.downArrow) {
						setState((prev) => ({
							...prev,
							menuIndex:
								prev.menuIndex < AUTH_MENU_ITEMS.length - 1
									? prev.menuIndex + 1
									: 0,
						}));
						return;
					}
					if (key.return) {
						const selected = AUTH_MENU_ITEMS[state.menuIndex]?.value;
						if (selected === "exit") {
							finalize(0);
							return;
						}
						if (selected === "byokey") {
							setState((prev) => ({
								...prev,
								screen: "provider",
								errorMessage: undefined,
							}));
							return;
						}
						const providerId =
							selected === "oauth-cline"
								? "cline"
								: selected === "oauth-openai-codex"
									? "openai-codex"
									: "oca";
						setState((prev) => ({
							...prev,
							busy: true,
							busyMessage: `Signing in to ${providerId}...`,
							errorMessage: undefined,
						}));
						void runAuthProviderCommand(
							input.providerSettingsManager,
							providerId,
							input.io,
						).then((code) => {
							if (code === 0) {
								finalize(0);
							} else {
								setState((prev) => ({
									...prev,
									busy: false,
									busyMessage: undefined,
									errorMessage: `Failed to authenticate with ${providerId}`,
								}));
							}
						});
					}
					return;
				}
				if (state.screen === "provider") {
					if (key.escape) {
						setState((prev) => ({ ...prev, screen: "menu" }));
						return;
					}
					if (key.upArrow) {
						setState((prev) => ({
							...prev,
							providerIndex:
								prev.providerIndex > 0
									? prev.providerIndex - 1
									: prev.providerIds.length - 1,
						}));
						return;
					}
					if (key.downArrow) {
						setState((prev) => ({
							...prev,
							providerIndex:
								prev.providerIndex < prev.providerIds.length - 1
									? prev.providerIndex + 1
									: 0,
						}));
						return;
					}
					if (value.toLowerCase() === "d") {
						const providerId = state.providerIds[state.providerIndex];
						if (!providerId) {
							return;
						}
						setState((prev) => ({
							...prev,
							screen: "confirm-delete-provider",
							providerPendingDelete: providerId,
							errorMessage: undefined,
						}));
						return;
					}
					if (key.return) {
						const providerId =
							state.providerIds[state.providerIndex] ?? "anthropic";
						const defaultModelId =
							input.providerSettingsManager.getProviderSettings(providerId)
								?.model ?? "";
						setState((prev) => ({
							...prev,
							selectedProvider: providerId,
							modelId: defaultModelId,
							screen: "apikey",
							errorMessage: undefined,
						}));
					}
					return;
				}
				if (state.screen === "confirm-delete-provider") {
					if (key.escape || value.toLowerCase() === "n") {
						setState((prev) => ({
							...prev,
							screen: "provider",
							providerPendingDelete: undefined,
						}));
						return;
					}
					if (value.toLowerCase() === "y" || key.return) {
						const providerId = state.providerPendingDelete;
						if (!providerId) {
							setState((prev) => ({
								...prev,
								screen: "provider",
								providerPendingDelete: undefined,
							}));
							return;
						}
						setState((prev) => ({
							...prev,
							busy: true,
							busyMessage: `Deleting provider ${providerId}...`,
							errorMessage: undefined,
						}));
						void deleteProviderFromAuth(
							input.providerSettingsManager,
							providerId,
						)
							.then(async () => {
								const nextCatalog = await loadProviderCatalog(
									input.providerSettingsManager,
								);
								const nextProviderIds = nextCatalog.map(
									(provider) => provider.id,
								);
								const nextProviderLabels = toProviderLabels(nextCatalog);
								setState((prev) => {
									const nextIndex = Math.min(
										prev.providerIndex,
										Math.max(0, nextProviderIds.length - 1),
									);
									return {
										...prev,
										busy: false,
										busyMessage: undefined,
										screen: "provider",
										providerPendingDelete: undefined,
										providerIds: nextProviderIds,
										providerLabels: nextProviderLabels,
										providerIndex: nextIndex,
										selectedProvider:
											nextProviderIds[nextIndex] ?? prev.selectedProvider,
									};
								});
							})
							.catch((error) => {
								setState((prev) => ({
									...prev,
									busy: false,
									busyMessage: undefined,
									screen: "provider",
									providerPendingDelete: undefined,
									errorMessage:
										error instanceof Error ? error.message : String(error),
								}));
							});
					}
					return;
				}
				if (state.screen === "apikey") {
					if (key.escape) {
						setState((prev) => ({ ...prev, screen: "provider" }));
						return;
					}
					if (key.return) {
						setState((prev) => ({ ...prev, screen: "modelid" }));
						return;
					}
					if (key.backspace || key.delete) {
						setState((prev) => ({
							...prev,
							apiKey: prev.apiKey.slice(0, -1),
						}));
						return;
					}
					if (
						!key.ctrl &&
						!key.meta &&
						value.length > 0 &&
						!value.includes("\u001b")
					) {
						setState((prev) => ({
							...prev,
							apiKey: prev.apiKey + value,
						}));
					}
					return;
				}
				if (state.screen === "modelid") {
					if (key.escape) {
						setState((prev) => ({ ...prev, screen: "apikey" }));
						return;
					}
					if (key.return) {
						if (
							currentProvider !== "openai" &&
							currentProvider !== "openai-native"
						) {
							setState((prev) => ({ ...prev, screen: "baseurl", baseUrl: "" }));
						} else {
							setState((prev) => ({ ...prev, screen: "baseurl" }));
						}
						return;
					}
					if (key.backspace || key.delete) {
						setState((prev) => ({
							...prev,
							modelId: prev.modelId.slice(0, -1),
						}));
						return;
					}
					if (
						!key.ctrl &&
						!key.meta &&
						value.length > 0 &&
						!value.includes("\u001b")
					) {
						setState((prev) => ({ ...prev, modelId: prev.modelId + value }));
					}
					return;
				}
				if (state.screen === "baseurl") {
					if (key.escape) {
						setState((prev) => ({ ...prev, screen: "modelid" }));
						return;
					}
					if (key.return) {
						const payload: AuthQuickSetupInput = {
							provider: currentProvider,
							apikey: state.apiKey,
							modelid: state.modelId,
							baseurl: state.baseUrl.trim() || undefined,
						};
						setState((prev) => ({
							...prev,
							busy: true,
							busyMessage: "Saving provider settings...",
							errorMessage: undefined,
						}));
						void ensureQuickSetupInputValid(
							payload,
							input.providerSettingsManager,
						).then((validationError) => {
							if (validationError) {
								setState((prev) => ({
									...prev,
									busy: false,
									busyMessage: undefined,
									errorMessage: validationError,
								}));
								return;
							}
							try {
								saveQuickAuthProviderSettings({
									providerSettingsManager: input.providerSettingsManager,
									providerId: normalizeProviderId(payload.provider),
									apikey: payload.apikey,
									modelid: payload.modelid,
									baseurl: payload.baseurl,
								});
								finalize(0);
							} catch (error) {
								setState((prev) => ({
									...prev,
									busy: false,
									busyMessage: undefined,
									errorMessage:
										error instanceof Error ? error.message : String(error),
								}));
							}
						});
						return;
					}
					if (key.backspace || key.delete) {
						setState((prev) => ({
							...prev,
							baseUrl: prev.baseUrl.slice(0, -1),
						}));
						return;
					}
					if (
						!key.ctrl &&
						!key.meta &&
						value.length > 0 &&
						!value.includes("\u001b")
					) {
						setState((prev) => ({ ...prev, baseUrl: prev.baseUrl + value }));
					}
				}
			});

			useEffect(() => {
				if (state.screen !== "done") {
					return;
				}
				props.onDone(state.exitCode);
				exit();
			}, [exit, props, state.exitCode, state.screen]);

			const menuItems = AUTH_MENU_ITEMS.map((item) => item.label);
			const providerItems = state.providerLabels;
			const showBaseUrlInput =
				currentProvider === "openai" || currentProvider === "openai-native";

			return React.createElement(
				Box,
				{ flexDirection: "column", paddingX: 1 },
				React.createElement(
					Text,
					{ bold: true, color: "white" },
					"Authentication Setup",
				),
				React.createElement(Text, { color: "gray" }, ""),
				state.errorMessage
					? React.createElement(Text, { color: "red" }, state.errorMessage)
					: null,
				state.busy
					? React.createElement(
							Text,
							{ color: "cyan" },
							state.busyMessage ?? "Working...",
						)
					: null,
				!state.busy && state.screen === "menu"
					? renderSelectableList({
							items: menuItems,
							selected: state.menuIndex,
							title: "Choose an auth option",
						})
					: null,
				!state.busy && state.screen === "provider"
					? renderSelectableList({
							items: providerItems,
							selected: state.providerIndex,
							title: "Select provider for API key setup",
						})
					: null,
				!state.busy && state.screen === "provider"
					? React.createElement(
							Text,
							{ color: "gray" },
							"Press d to delete selected provider config",
						)
					: null,
				!state.busy && state.screen === "confirm-delete-provider"
					? React.createElement(
							Box,
							{ flexDirection: "column", marginBottom: 1 },
							React.createElement(
								Text,
								{ color: "yellow", bold: true },
								`Delete provider "${state.providerPendingDelete ?? ""}"?`,
							),
							React.createElement(
								Text,
								{ color: "gray" },
								"This removes saved config and deletes custom providers.",
							),
							React.createElement(
								Text,
								{ color: "gray" },
								"Press y or Enter to confirm, n or Esc to cancel",
							),
						)
					: null,
				!state.busy && state.screen === "apikey"
					? renderPromptInput({
							title: `API key for ${currentProvider}`,
							value: state.apiKey,
							placeholder: "sk-...",
							secret: true,
						})
					: null,
				!state.busy && state.screen === "modelid"
					? renderPromptInput({
							title: `Model ID for ${currentProvider}`,
							value: state.modelId,
							placeholder:
								input.providerSettingsManager.getProviderSettings(
									currentProvider,
								)?.model ?? "",
						})
					: null,
				!state.busy && state.screen === "baseurl"
					? renderPromptInput({
							title: showBaseUrlInput
								? "Base URL (optional)"
								: "Press Enter to save",
							value: showBaseUrlInput ? state.baseUrl : "",
							placeholder: "https://api.example.com/v1",
						})
					: null,
			);
		}

		let settled = false;
		const app = render(
			React.createElement(AuthTui, {
				onDone: (code) => {
					if (settled) {
						return;
					}
					settled = true;
					resolve(code);
				},
			}),
			{ exitOnCtrlC: false },
		);
		void app.waitUntilExit().then(() => {
			if (!settled) {
				settled = true;
				resolve(1);
			}
		});
	});
}

export async function runAuthCommand(input: AuthCommandInput): Promise<number> {
	const hasQuickSetupFlags =
		typeof input.apikey === "string" ||
		typeof input.modelid === "string" ||
		typeof input.baseurl === "string";

	if (hasQuickSetupFlags) {
		if (!input.explicitProvider?.trim()) {
			input.io.writeErr(
				"auth quick setup requires --provider <id> when using --apikey/--modelid/--baseurl",
			);
			return 1;
		}
		return runQuickAuthSetup(input);
	}

	if (input.explicitProvider?.trim()) {
		const providerId = normalizeAuthProviderId(input.explicitProvider);
		if (isOAuthProvider(providerId)) {
			return runAuthProviderCommand(
				input.providerSettingsManager,
				providerId,
				input.io,
			);
		}
		input.io.writeErr(
			`provider "${providerId}" requires API key setup (use subcommand: auth --provider ${providerId} --apikey <key> --modelid <id>)`,
		);
		return 1;
	}

	return runInteractiveAuthTui(input);
}

export async function runAuthProviderCommand(
	providerSettingsManager: ProviderSettingsManager,
	providerId: string,
	io: AuthIo,
): Promise<number> {
	if (!isOAuthProvider(providerId)) {
		io.writeErr(
			`provider "${providerId}" does not support OAuth login (supported: cline, openai-codex, oca)`,
		);
		return 1;
	}
	try {
		const existing = providerSettingsManager.getProviderSettings(providerId);
		const credentials = await loginWithOAuthProvider(providerId, existing, io);
		saveOAuthProviderSettings(
			providerSettingsManager,
			providerId,
			existing,
			credentials,
		);
		io.writeln(
			`${c.green}You are now logged in to ${c.cyan}${providerId}${c.reset}`,
		);
		return 0;
	} catch (error) {
		io.writeErr(error instanceof Error ? error.message : String(error));
		return 1;
	}
}
