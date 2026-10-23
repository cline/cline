/**
 * Environment separation for the mobile client.
 *
 * Selected at build time by `EXPO_PUBLIC_ENV`, which Expo's Babel transform
 * inlines into the bundle. It must therefore be read as a literal
 * `process.env.EXPO_PUBLIC_ENV` member expression - destructuring or dynamic
 * indexing would not survive the transform.
 *
 * Staging is the default so that an un-configured local build can never point a
 * dev device at production.
 */

export type EnvironmentName = "staging" | "production";

export interface EnvironmentConfig {
	readonly name: EnvironmentName;
	/** Session/relay host the app connects to for agent sessions. No trailing slash. */
	readonly sessionBaseUrl: string;
	/** Cline REST API host. No trailing slash. */
	readonly apiBaseUrl: string;
}

export const ENVIRONMENTS: Readonly<
	Record<EnvironmentName, EnvironmentConfig>
> = {
	staging: {
		name: "staging",
		sessionBaseUrl: "https://session.staging.cline.bot",
		apiBaseUrl: "https://api.staging.cline.bot",
	},
	production: {
		name: "production",
		sessionBaseUrl: "https://session.cline.bot",
		apiBaseUrl: "https://api.cline.bot",
	},
} as const;

export const DEFAULT_ENVIRONMENT_NAME: EnvironmentName = "staging";
export const DEFAULT_ENVIRONMENT: EnvironmentConfig =
	ENVIRONMENTS[DEFAULT_ENVIRONMENT_NAME];

export function isEnvironmentName(value: unknown): value is EnvironmentName {
	return value === "staging" || value === "production";
}

/** Unknown, empty and missing values all fall back to staging. */
export function resolveEnvironment(
	raw: string | null | undefined,
): EnvironmentConfig {
	const normalized = raw?.trim().toLowerCase();
	return isEnvironmentName(normalized)
		? ENVIRONMENTS[normalized]
		: DEFAULT_ENVIRONMENT;
}

export const env: EnvironmentConfig = resolveEnvironment(
	process.env.EXPO_PUBLIC_ENV,
);

/**
 * Cline Cloud configuration (WorkOS device-flow auth + core-api REST/WS proxy).
 *
 * This is separate from {@link EnvironmentConfig} above because the cloud stack
 * lives on different hosts than the legacy relay: the sessions REST API and the
 * WS proxy are both served by the core-api instance, and WorkOS is contacted
 * directly for the device-authorization sign-in. Values are the ground truth
 * used by the Cloud device-authorization flow.
 */
export interface CloudEnvironmentConfig {
	readonly name: EnvironmentName;
	/**
	 * WorkOS API base for the device-authorization flow. Constant across envs, but
	 * threaded into `startClineDeviceAuth`/`completeClineDeviceAuth` as their
	 * `workOsBaseUrl` rather than left to the SDK's default, so this record is the
	 * single source of truth for every host the sign-in flow talks to.
	 */
	readonly workOsBaseUrl: string;
	/** WorkOS client id used by the device flow for this environment. */
	readonly workOsClientId: string;
	/** Cline core-api base: REST sessions API + WS proxy. No trailing slash. */
	readonly apiBaseUrl: string;
	/** Cline web app base (GitHub-connect / org deep links). No trailing slash. */
	readonly appBaseUrl: string;
}

export const CLOUD_ENVIRONMENTS: Readonly<
	Record<EnvironmentName, CloudEnvironmentConfig>
> = {
	staging: {
		name: "staging",
		workOsBaseUrl: "https://api.workos.com",
		workOsClientId: "client_01K3A5415VF6QBQBG3XYCW91G6",
		apiBaseUrl: "https://core-api.staging.int.cline.bot",
		appBaseUrl: "https://staging-app.cline.bot",
	},
	production: {
		name: "production",
		workOsBaseUrl: "https://api.workos.com",
		workOsClientId: "client_01K3A541FN8TA3EPPHTD2325AR",
		apiBaseUrl: "https://api.cline.bot",
		appBaseUrl: "https://app.cline.bot",
	},
} as const;

/** Unknown, empty and missing values all fall back to staging. */
export function resolveCloudEnvironment(
	raw: string | null | undefined,
): CloudEnvironmentConfig {
	const normalized = raw?.trim().toLowerCase();
	return isEnvironmentName(normalized)
		? CLOUD_ENVIRONMENTS[normalized]
		: CLOUD_ENVIRONMENTS[DEFAULT_ENVIRONMENT_NAME];
}

export const cloudEnv: CloudEnvironmentConfig = resolveCloudEnvironment(
	process.env.EXPO_PUBLIC_ENV,
);

/**
 * Dev-only auto-discovery of a local hub (`bun run scripts/dev-hub.ts`).
 *
 * A dev build reads `EXPO_PUBLIC_DEV_HUB_URL` / `EXPO_PUBLIC_DEV_HUB_TOKEN`,
 * which Expo inlines like any other `EXPO_PUBLIC_*` value, so a one-tap "connect
 * to local hub" affordance works without hardcoding a machine's address. The
 * `dev-hub.ts` script also writes `apps/mobile/.dev-hub.json` (the same url +
 * token); a dev launcher can copy those into these env vars.
 *
 * Both must be read as literal `process.env.*` member expressions to survive the
 * Babel transform, exactly like {@link env} above.
 */
export interface DevHubEndpoint {
	url: string;
	authToken?: string;
}

/** The local-hub endpoint from env, or `undefined` when not configured. */
export function resolveDevHubEndpoint(): DevHubEndpoint | undefined {
	const url = process.env.EXPO_PUBLIC_DEV_HUB_URL?.trim();
	if (!url) {
		return undefined;
	}
	const authToken = process.env.EXPO_PUBLIC_DEV_HUB_TOKEN?.trim();
	return authToken ? { url, authToken } : { url };
}

export const devHubEndpoint: DevHubEndpoint | undefined =
	resolveDevHubEndpoint();
