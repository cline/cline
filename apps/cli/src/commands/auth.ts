import { createInterface } from "node:readline";
import {
	BUILT_IN_PROVIDER,
	createOAuthClientCallbacks,
	ensureCustomProvidersLoaded,
	getProviderAuthHandler,
	listLocalProviders,
	loginAndSaveProviderOAuthCredentials,
	type ProviderSettings,
	type ProviderSettingsManager,
	saveProviderOAuthCredentials,
} from "@cline/core";
import { Command } from "commander";
import open from "open";
import React from "react";
import { disableOpenTuiGraphicsProbe } from "../tui/opentui-env";
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

type AuthIo = {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
};

type AuthQuickSetupInput = {
	provider: string;
	apikey: string;
	modelid: string;
	baseurl?: string;
	azureApiVersion?: string;
	headers?: Record<string, string>;
	clearHeaders?: boolean;
	contextWindow?: number;
	maxOutputTokens?: number;
	supportsImages?: boolean;
};

type AuthCommandInput = {
	providerSettingsManager: ProviderSettingsManager;
	io: AuthIo;
	explicitProvider?: string;
	apikey?: string;
	modelid?: string;
	baseurl?: string;
	azureApiVersion?: string;
	header?: string[];
	clearHeaders?: boolean;
	contextWindow?: string;
	maxOutputTokens?: string;
	supportsImages?: boolean;
};

type ParsedAuthCommandArgs = {
	explicitProvider?: string;
	apikey?: string;
	modelid?: string;
	baseurl?: string;
	azureApiVersion?: string;
	header?: string[];
	clearHeaders?: boolean;
	contextWindow?: string;
	maxOutputTokens?: string;
	supportsImages?: boolean;
	parseError?: string;
};

/**
 * Create the `auth` subcommand for Commander.
 *
 * In the auth context, `-p` means `--provider` and `-m` means `--modelid`,
 * which intentionally shadows the global `-p` (--plan) and `-m` (--model)
 * short flags. Commander scopes options per-command, so there is no conflict.
 */
function collectRepeatable(value: string, previous: string[]): string[] {
	return [...previous, value];
}

export function createAuthCommand(): Command {
	const cmd = new Command("auth")
		.description("Authenticate with an LLM provider")
		.exitOverride()
		.configureOutput({ writeOut: () => {}, writeErr: () => {} })
		.argument("[provider]", "provider id (positional shorthand for -p)")
		.option("-p, --provider <id>", "provider id")
		.option("-k, --apikey <key>", "API key")
		.option("-m, --modelid <id>", "model id")
		.option("-b, --baseurl <url>", "base URL")
		.option("--azure-api-version <version>", "Azure API version")
		.option(
			"-H, --header <key=value>",
			"custom HTTP header sent on every request (repeatable)",
			collectRepeatable,
			[],
		)
		.option("--context-window <tokens>", "context window size for the model")
		.option(
			"--max-output-tokens <tokens>",
			"max output tokens per request for the model",
		)
		.option("--supports-images", "mark the model as supporting image input")
		.option(
			"--no-supports-images",
			"mark the model as not supporting image input",
		)
		.option("--clear-headers", "remove all saved custom headers");
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
		azureApiVersion?: string;
		header?: string[];
		clearHeaders?: boolean;
		contextWindow?: string;
		maxOutputTokens?: string;
		supportsImages?: boolean;
	}>();
	const positionalProvider = cmd.args[0];
	return {
		explicitProvider: opts.provider ?? positionalProvider,
		apikey: opts.apikey,
		modelid: opts.modelid,
		baseurl: opts.baseurl,
		azureApiVersion: opts.azureApiVersion,
		header: opts.header,
		clearHeaders: opts.clearHeaders,
		contextWindow: opts.contextWindow,
		maxOutputTokens: opts.maxOutputTokens,
		supportsImages: opts.supportsImages,
	};
}

export function parseHeaderFlags(values: string[] | undefined): {
	headers?: Record<string, string>;
	error?: string;
} {
	if (!values || values.length === 0) {
		return {};
	}
	const headers: Record<string, string> = {};
	for (const value of values) {
		// Split at the first "=" so header values may contain "=" themselves.
		const separatorIndex = value.indexOf("=");
		const key = separatorIndex > 0 ? value.slice(0, separatorIndex).trim() : "";
		if (!key) {
			return {
				error: `invalid --header "${value}" (expected format: key=value)`,
			};
		}
		headers[key] = value.slice(separatorIndex + 1).trim();
	}
	return { headers };
}

function parsePositiveInteger(
	value: string | undefined,
	flag: string,
): { parsed?: number; error?: string } {
	if (value === undefined) {
		return {};
	}
	const parsed = Number.parseInt(value, 10);
	if (
		!Number.isFinite(parsed) ||
		parsed <= 0 ||
		String(parsed) !== value.trim()
	) {
		return {
			error: `invalid ${flag} "${value}" (expected a positive integer)`,
		};
	}
	return { parsed };
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

async function ensureQuickSetupInputValid(
	input: AuthQuickSetupInput,
	providerSettingsManager: ProviderSettingsManager,
): Promise<string | undefined> {
	const normalizedProvider = normalizeProviderId(input.provider);
	const providerCatalog = await loadProviderCatalog(providerSettingsManager);
	if (!providerCatalog.some((provider) => provider.id === normalizedProvider)) {
		return `invalid provider "${input.provider}"`;
	}
	const existing =
		providerSettingsManager.getProviderSettings(normalizedProvider);
	const hasStoredApiKey = Boolean(
		existing?.apiKey?.trim() || existing?.auth?.accessToken?.trim(),
	);
	if (!input.apikey.trim() && !hasStoredApiKey) {
		return "auth quick setup requires --apikey <key>";
	}
	if (!input.modelid.trim() && !existing?.model?.trim()) {
		return "auth quick setup requires --modelid <id>";
	}
	if (
		input.baseurl?.trim() &&
		normalizedProvider !== BUILT_IN_PROVIDER.OPENAI_COMPATIBLE &&
		normalizedProvider !== BUILT_IN_PROVIDER.OPENAI_NATIVE
	) {
		return "base URL is only supported for OpenAI and OpenAI-compatible providers";
	}
	if (
		input.azureApiVersion?.trim() &&
		normalizedProvider !== BUILT_IN_PROVIDER.OPENAI_COMPATIBLE
	) {
		return "Azure API version is only supported for OpenAI-compatible providers";
	}
	if (
		((input.headers && Object.keys(input.headers).length > 0) ||
			input.clearHeaders) &&
		normalizedProvider !== BUILT_IN_PROVIDER.OPENAI_COMPATIBLE &&
		normalizedProvider !== BUILT_IN_PROVIDER.OPENAI_NATIVE
	) {
		return "custom headers are only supported for OpenAI and OpenAI-compatible providers";
	}
	if (
		(input.contextWindow !== undefined ||
			input.maxOutputTokens !== undefined ||
			input.supportsImages !== undefined) &&
		normalizedProvider !== BUILT_IN_PROVIDER.OPENAI_COMPATIBLE
	) {
		return "model configuration options (--context-window, --max-output-tokens, --supports-images) are only supported for the OpenAI-compatible provider";
	}
	return undefined;
}

function saveQuickAuthProviderSettings(input: {
	providerSettingsManager: ProviderSettingsManager;
	providerId: string;
	apikey: string;
	modelid: string;
	baseurl?: string;
	azureApiVersion?: string;
	headers?: Record<string, string>;
	clearHeaders?: boolean;
	contextWindow?: number;
	maxOutputTokens?: number;
	supportsImages?: boolean;
}): void {
	const existing = input.providerSettingsManager.getProviderSettings(
		input.providerId,
	);
	const nextSettings: ProviderSettings = {
		...(existing ?? {
			provider: input.providerId as ProviderSettings["provider"],
		}),
		provider: input.providerId as ProviderSettings["provider"],
	};
	if (input.apikey.trim()) {
		nextSettings.apiKey = input.apikey;
	}
	if (input.modelid.trim()) {
		nextSettings.model = input.modelid;
	}
	if (input.baseurl?.trim()) {
		nextSettings.baseUrl = input.baseurl.trim();
	}
	if (input.azureApiVersion?.trim()) {
		nextSettings.azure = {
			...(nextSettings.azure ?? {}),
			apiVersion: input.azureApiVersion.trim(),
		};
	}
	if (input.clearHeaders) {
		delete nextSettings.headers;
	}
	if (input.headers && Object.keys(input.headers).length > 0) {
		nextSettings.headers = {
			...(input.clearHeaders ? {} : (existing?.headers ?? {})),
			...input.headers,
		};
	}
	if (input.contextWindow !== undefined) {
		nextSettings.contextWindow = input.contextWindow;
	}
	if (input.maxOutputTokens !== undefined) {
		nextSettings.maxTokens = input.maxOutputTokens;
	}
	if (input.supportsImages !== undefined) {
		// Model capabilities default to "images allowed" when unset, so an
		// explicit flag pins the capability list either way. Streaming and
		// tools stay on; they are table stakes for any model Cline can drive.
		const capabilities = new Set<
			NonNullable<ProviderSettings["capabilities"]>[number]
		>(existing?.capabilities ?? ["streaming", "tools"]);
		if (input.supportsImages) {
			capabilities.add("vision");
		} else {
			capabilities.delete("vision");
		}
		nextSettings.capabilities = [...capabilities];
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
			io.writeln(
				`${c.dim}[auth] Browser open failed: ${error instanceof Error ? error.message : String(error)}${c.reset}`,
			);
		},
	});
}

export function saveOAuthProviderSettings(
	providerSettingsManager: ProviderSettingsManager,
	providerId: string,
	existing: ProviderSettings | undefined,
	credentials: OAuthCredentials,
): ProviderSettings {
	return saveProviderOAuthCredentials({
		manager: providerSettingsManager,
		providerId,
		settings: existing,
		credentials,
	});
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
	const selectedProviderSettings = await loginAndSaveProviderOAuthCredentials(
		input.providerSettingsManager,
		input.providerId,
		{ callbacks: createOAuthCallbacks(input.io) },
	);
	const handler = getProviderAuthHandler(input.providerId);
	return {
		apiKey: handler?.getApiKey(selectedProviderSettings),
		selectedProviderSettings,
	};
}

async function runQuickAuthSetup(input: AuthCommandInput): Promise<number> {
	const providerId = normalizeProviderId((input.explicitProvider ?? "").trim());
	const apikey = input.apikey?.trim() ?? "";
	const modelid = input.modelid?.trim() ?? "";
	const baseurl = input.baseurl?.trim();
	const azureApiVersion = input.azureApiVersion?.trim();
	const { headers, error: headerError } = parseHeaderFlags(input.header);
	if (headerError) {
		input.io.writeErr(headerError);
		return 1;
	}
	const contextWindow = parsePositiveInteger(
		input.contextWindow,
		"--context-window",
	);
	if (contextWindow.error) {
		input.io.writeErr(contextWindow.error);
		return 1;
	}
	const maxOutputTokens = parsePositiveInteger(
		input.maxOutputTokens,
		"--max-output-tokens",
	);
	if (maxOutputTokens.error) {
		input.io.writeErr(maxOutputTokens.error);
		return 1;
	}
	const validationError = await ensureQuickSetupInputValid(
		{
			provider: providerId,
			apikey,
			modelid,
			baseurl,
			azureApiVersion,
			headers,
			clearHeaders: input.clearHeaders,
			contextWindow: contextWindow.parsed,
			maxOutputTokens: maxOutputTokens.parsed,
			supportsImages: input.supportsImages,
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
		azureApiVersion,
		headers,
		clearHeaders: input.clearHeaders,
		contextWindow: contextWindow.parsed,
		maxOutputTokens: maxOutputTokens.parsed,
		supportsImages: input.supportsImages,
	});
	const configuredModelId =
		modelid ||
		input.providerSettingsManager.getProviderSettings(providerId)?.model ||
		"";
	input.io.writeln(
		`${c.green}Provider configured:${c.reset} ${c.cyan}${providerId}${c.reset} (${configuredModelId})`,
	);
	return 0;
}

export async function loadAuthTuiRuntime() {
	disableOpenTuiGraphicsProbe();
	const { createCliRenderer } = await import("@opentui/core");
	const { createRoot } = await import("@opentui/react");
	const { OnboardingView } = await import("../tui/views/onboarding");
	return { createCliRenderer, createRoot, OnboardingView };
}

async function runInteractiveAuthTui(input: AuthCommandInput): Promise<number> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		input.io.writeErr(
			"interactive auth setup requires a TTY (use --provider/--apikey/--modelid for non-interactive setup)",
		);
		return 1;
	}
	const { createCliRenderer, createRoot, OnboardingView } =
		await loadAuthTuiRuntime();
	const renderer = await createCliRenderer({
		exitOnCtrlC: false,
		autoFocus: false,
		enableMouseMovement: true,
	});

	return await new Promise<number>((resolve, reject) => {
		let root: ReturnType<typeof createRoot>;
		try {
			root = createRoot(renderer);
		} catch (error) {
			renderer.destroy();
			reject(error);
			return;
		}
		let settled = false;
		let unmounted = false;
		const unmountRoot = () => {
			if (unmounted) {
				return;
			}
			unmounted = true;
			root.unmount();
		};
		const settle = (code: number) => {
			if (settled) {
				return;
			}
			settled = true;
			unmountRoot();
			renderer.destroy();
			resolve(code);
		};
		renderer.on("destroy", () => {
			unmountRoot();
			if (!settled) {
				settled = true;
				resolve(1);
			}
		});
		try {
			root.render(
				React.createElement(OnboardingView, {
					providerSettingsManager: input.providerSettingsManager,
					onComplete: () => settle(0),
					onExit: () => settle(1),
				}),
			);
		} catch (error) {
			unmountRoot();
			renderer.destroy();
			reject(error);
		}
	});
}

export async function runAuthCommand(input: AuthCommandInput): Promise<number> {
	const hasQuickSetupFlags =
		typeof input.apikey === "string" ||
		typeof input.modelid === "string" ||
		typeof input.baseurl === "string" ||
		typeof input.azureApiVersion === "string" ||
		(input.header?.length ?? 0) > 0 ||
		input.clearHeaders === true ||
		typeof input.contextWindow === "string" ||
		typeof input.maxOutputTokens === "string" ||
		typeof input.supportsImages === "boolean";

	if (hasQuickSetupFlags) {
		if (!input.explicitProvider?.trim()) {
			input.io.writeErr(
				"auth quick setup requires --provider <id> when using auth options like --apikey/--modelid/--baseurl/--header",
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
		await loginAndSaveProviderOAuthCredentials(
			providerSettingsManager,
			providerId,
			{ callbacks: createOAuthCallbacks(io) },
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
