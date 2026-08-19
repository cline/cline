import {
	chmodSync,
	existsSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {
	getClineEnvironmentConfig,
	refreshClineOAuthCredentials,
} from "@cline/shared";
import { resolveProviderSettingsPath } from "@cline/shared/storage";
import { z } from "zod";

const AuthSettingsSchema = z
	.object({
		apiKey: z.string().optional(),
		accessToken: z.string().optional(),
		refreshToken: z.string().optional(),
		expiresAt: z.number().optional(),
		accountId: z.string().optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
	})
	.passthrough();

const ProviderSettingsSchema = z
	.object({
		provider: z.string().min(1),
		model: z.string().min(1).optional(),
		apiKey: z.string().optional(),
		auth: AuthSettingsSchema.optional(),
		baseUrl: z.string().optional(),
		headers: z.record(z.string(), z.string()).optional(),
		timeout: z.number().int().positive().optional(),
		region: z.string().optional(),
		apiLine: z.enum(["china", "international"]).optional(),
		client: z.string().optional(),
		aws: z.record(z.string(), z.unknown()).optional(),
		gcp: z.record(z.string(), z.unknown()).optional(),
		azure: z.record(z.string(), z.unknown()).optional(),
		sap: z.record(z.string(), z.unknown()).optional(),
	})
	.passthrough();

const StoredProviderSettingsSchema = z.object({
	version: z.literal(1),
	lastUsedProvider: z.string().min(1).optional(),
	providers: z.record(
		z.string(),
		z.object({ settings: ProviderSettingsSchema }).passthrough(),
	),
});

export type SavedProviderSettings = z.infer<typeof ProviderSettingsSchema>;

export interface SavedProviderSelection {
	readonly providerId: string;
	readonly settings: SavedProviderSettings;
}

export interface SavedProviderSummary {
	readonly providerId: string;
	readonly modelIds: string[];
}

/** List configured provider/model pairs without exposing credentials or options. */
export async function listSavedProviderSummaries(
	options: { filePath?: string; env?: Record<string, string | undefined> } = {},
): Promise<{ providers: SavedProviderSummary[]; selectedProviderId?: string }> {
	const filePath =
		options.filePath ?? gatewayProviderSettingsPath(options.env ?? process.env);
	if (!existsSync(filePath)) return { providers: [] };
	try {
		const parsed = StoredProviderSettingsSchema.parse(
			JSON.parse(readFileSync(filePath, "utf8")),
		);
		const providers = Object.entries(parsed.providers)
			.map(([providerId, entry]) => {
				const savedModel = entry.settings.model?.trim();
				const modelIds = savedModel ? [savedModel] : [];
				return modelIds.length > 0 ? { providerId, modelIds } : undefined;
			})
			.filter((provider): provider is SavedProviderSummary =>
				Boolean(provider),
			);
		return {
			providers,
			...(parsed.lastUsedProvider
				? { selectedProviderId: parsed.lastUsedProvider }
				: {}),
		};
	} catch {
		return { providers: [] };
	}
}

export function gatewayProviderSettingsPath(
	env: Record<string, string | undefined> = process.env,
): string {
	return (
		env.CLINE_PROVIDER_SETTINGS_PATH?.trim() || resolveProviderSettingsPath()
	);
}

/** Read the selected provider from the shared CLI/Core providers.json store. */
export function readSavedProviderSelection(
	providerId: string | undefined,
	options: {
		filePath?: string;
		env?: Record<string, string | undefined>;
	} = {},
): SavedProviderSelection | undefined {
	const filePath =
		options.filePath ?? gatewayProviderSettingsPath(options.env ?? process.env);
	if (!existsSync(filePath)) return undefined;

	let parsed: z.infer<typeof StoredProviderSettingsSchema>;
	try {
		parsed = StoredProviderSettingsSchema.parse(
			JSON.parse(readFileSync(filePath, "utf8")),
		);
	} catch {
		return undefined;
	}

	const selectedProviderId = providerId ?? parsed.lastUsedProvider;
	if (!selectedProviderId) return undefined;
	const direct = parsed.providers[selectedProviderId]?.settings;
	if (!direct) return undefined;

	// Cline Pass shares the Cline OAuth credential bucket in the existing
	// provider store while retaining its own model selection.
	const credentialSettings =
		selectedProviderId === "cline-pass"
			? parsed.providers.cline?.settings
			: undefined;
	return {
		providerId: selectedProviderId,
		settings: {
			...(credentialSettings?.apiKey
				? { apiKey: credentialSettings.apiKey }
				: {}),
			...(credentialSettings?.auth ? { auth: credentialSettings.auth } : {}),
			...direct,
		},
	};
}

function compact(
	value: Record<string, unknown>,
): Record<string, unknown> | undefined {
	const entries = Object.entries(value).filter(
		([, item]) => item !== undefined,
	);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** Translate persisted provider-specific settings to @cline/llms options. */
export function savedProviderOptions(
	settings: SavedProviderSettings,
): Record<string, unknown> | undefined {
	const options: Record<string, unknown> = {
		region: settings.region,
		apiLine: settings.apiLine,
	};

	if (
		settings.provider === "openai-compatible" ||
		settings.client === "openai-compatible"
	) {
		Object.assign(options, {
			apiVersion: settings.azure?.apiVersion,
			useIdentity: settings.azure?.useIdentity,
		});
	}
	if (settings.provider === "bedrock") {
		Object.assign(options, {
			authentication: settings.aws?.authentication,
			profile: settings.aws?.profile,
			accessKeyId: settings.aws?.accessKey,
			secretAccessKey: settings.aws?.secretKey,
			sessionToken: settings.aws?.sessionToken,
			usePromptCache: settings.aws?.usePromptCache,
			useCrossRegionInference: settings.aws?.useCrossRegionInference,
			useGlobalInference: settings.aws?.useGlobalInference,
			endpoint: settings.aws?.endpoint,
			customModelBaseId: settings.aws?.customModelBaseId,
		});
	}
	if (settings.provider === "vertex") {
		const region = settings.gcp?.region ?? settings.region;
		Object.assign(options, {
			project: settings.gcp?.projectId,
			projectId: settings.gcp?.projectId,
			location: region,
			region,
		});
	}
	if (settings.provider === "sapaicore") {
		Object.assign(options, settings.sap);
	}

	return compact(options);
}

/** Resolve the credential shape expected by the provider gateway. */
export function savedProviderApiKey(
	providerId: string,
	settings: SavedProviderSettings,
): string | undefined {
	const credential =
		settings.auth?.accessToken?.trim() ||
		settings.apiKey?.trim() ||
		settings.auth?.apiKey?.trim();
	if (!credential) return undefined;
	if (providerId === "cline" || providerId === "cline-pass") {
		return credential.toLowerCase().startsWith("workos:")
			? credential
			: `workos:${credential}`;
	}
	return credential;
}

const OAUTH_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** Refresh the shared Cline OAuth bucket and atomically persist token rotation. */
export async function resolveSavedClineOAuthApiKey(
	providerId: string,
	options: { filePath?: string; env?: Record<string, string | undefined> } = {},
): Promise<string | undefined> {
	if (providerId !== "cline" && providerId !== "cline-pass") return undefined;
	const filePath =
		options.filePath ?? gatewayProviderSettingsPath(options.env ?? process.env);
	if (!existsSync(filePath)) return undefined;

	const stored = StoredProviderSettingsSchema.parse(
		JSON.parse(readFileSync(filePath, "utf8")),
	);
	const settings = stored.providers.cline?.settings;
	const auth = settings?.auth;
	const access = auth?.accessToken?.trim();
	const refresh = auth?.refreshToken?.trim();
	if (!auth || !access || !refresh) return undefined;
	const expires = auth.expiresAt ?? 0;
	if (Date.now() < expires - OAUTH_REFRESH_BUFFER_MS) {
		return savedProviderApiKey(providerId, settings);
	}

	const next = await refreshClineOAuthCredentials(
		{
			access: access.toLowerCase().startsWith("workos:")
				? access.slice(7)
				: access,
			refresh,
			expires,
			accountId: auth.accountId,
			metadata: auth.metadata,
		},
		{
			apiBaseUrl:
				settings.baseUrl?.trim() || getClineEnvironmentConfig().apiBaseUrl,
			provider:
				typeof auth.metadata?.provider === "string"
					? auth.metadata.provider
					: undefined,
		},
	);
	const updated = {
		...stored,
		providers: {
			...stored.providers,
			cline: {
				...stored.providers.cline,
				settings: {
					...settings,
					auth: {
						...auth,
						accessToken: next.access,
						refreshToken: next.refresh,
						expiresAt: next.expires,
						accountId: next.accountId,
						metadata: next.metadata,
					},
				},
				updatedAt: new Date().toISOString(),
				tokenSource: "oauth",
			},
		},
	};
	const temporary = `${filePath}.${process.pid}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(updated, null, 2)}\n`, {
			mode: 0o600,
		});
		chmodSync(temporary, 0o600);
		renameSync(temporary, filePath);
	} finally {
		rmSync(temporary, { force: true });
	}
	return `workos:${next.access}`;
}
