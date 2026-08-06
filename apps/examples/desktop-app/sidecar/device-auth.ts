import { randomUUID } from "node:crypto";
import type { ProviderSettingsManager } from "@cline/core";
import {
	completeClineDeviceAuth,
	getProviderAuthStorageId,
	markLocalProviderEnabled,
	saveLocalProviderOAuthCredentials,
	startClineDeviceAuth,
} from "@cline/core";
import { getClineEnvironmentConfig } from "@cline/shared";

const CLINE_PROVIDER_ID = "cline";

export class DeviceAuthCancelledError extends Error {
	constructor() {
		super("Device sign-in was cancelled");
		this.name = "DeviceAuthCancelledError";
	}
}

type PendingDeviceAuth = {
	deviceCode: string;
	expiresInSeconds: number;
	pollIntervalSeconds: number;
	cancelled: boolean;
	cancel: () => void;
	/** Set while a completion poll is in flight so cancel rejects it. */
	notifyCancelled?: () => void;
	/** Transport connection that started the flow, when known. */
	owner?: object;
};

// Device codes never leave the sidecar: the webview only sees an opaque
// authId plus the user-facing code/URL, so a compromised or reloaded webview
// cannot replay the polling secret.
const pendingDeviceAuthsById = new Map<string, PendingDeviceAuth>();

export type DeviceAuthDependencies = {
	start: typeof startClineDeviceAuth;
	complete: typeof completeClineDeviceAuth;
	save: typeof saveLocalProviderOAuthCredentials;
	markEnabled: typeof markLocalProviderEnabled;
};

const defaultDependencies: DeviceAuthDependencies = {
	start: startClineDeviceAuth,
	complete: completeClineDeviceAuth,
	save: saveLocalProviderOAuthCredentials,
	markEnabled: markLocalProviderEnabled,
};

export type StartedDeviceAuth = {
	authId: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete?: string;
	expiresInSeconds: number;
};

/**
 * Requests a WorkOS device authorization for the Cline provider and returns
 * the user-facing code and verification URL. The device code itself is kept
 * sidecar-side, keyed by the returned `authId`.
 */
export async function startClineDeviceAuthFlow(
	options: { owner?: object } = {},
	dependencies: DeviceAuthDependencies = defaultDependencies,
): Promise<StartedDeviceAuth> {
	const authorization = await dependencies.start();
	const authId = randomUUID();
	const entry: PendingDeviceAuth = {
		deviceCode: authorization.deviceCode,
		expiresInSeconds: authorization.expiresInSeconds,
		pollIntervalSeconds: authorization.pollIntervalSeconds,
		cancelled: false,
		cancel: () => {
			entry.cancelled = true;
			entry.notifyCancelled?.();
		},
		owner: options.owner,
	};
	pendingDeviceAuthsById.set(authId, entry);
	return {
		authId,
		userCode: authorization.userCode,
		verificationUri: authorization.verificationUri,
		verificationUriComplete: authorization.verificationUriComplete,
		expiresInSeconds: authorization.expiresInSeconds,
	};
}

/**
 * Polls WorkOS until the user approves the device code in their browser,
 * then persists the resulting Cline credentials. Cancellation rejects
 * immediately AND guarantees a late-completing authorization is never
 * persisted, mirroring the browser OAuth flow's safety property.
 */
export async function completeClineDeviceAuthFlow(
	manager: ProviderSettingsManager,
	authId: string,
	dependencies: DeviceAuthDependencies = defaultDependencies,
): Promise<{ provider: string; accessToken: string }> {
	const entry = pendingDeviceAuthsById.get(authId);
	if (!entry) {
		throw new Error("Unknown or expired device sign-in attempt");
	}
	if (entry.cancelled) {
		pendingDeviceAuthsById.delete(authId);
		throw new DeviceAuthCancelledError();
	}

	const storageProviderId =
		getProviderAuthStorageId(CLINE_PROVIDER_ID) ?? CLINE_PROVIDER_ID;
	const existing = manager.getProviderSettings(storageProviderId);

	let rejectOnCancel: (error: Error) => void = () => undefined;
	const cancellation = new Promise<never>((_, reject) => {
		rejectOnCancel = reject;
	});
	entry.notifyCancelled = () => rejectOnCancel(new DeviceAuthCancelledError());

	try {
		// Promise.race keeps the polling promise observed, so a late rejection
		// after cancellation cannot become an unhandled rejection.
		const credentials = await Promise.race([
			dependencies.complete({
				deviceCode: entry.deviceCode,
				expiresInSeconds: entry.expiresInSeconds,
				pollIntervalSeconds: entry.pollIntervalSeconds,
				apiBaseUrl:
					existing?.baseUrl?.trim() || getClineEnvironmentConfig().apiBaseUrl,
			}),
			cancellation,
		]);
		if (entry.cancelled) {
			throw new DeviceAuthCancelledError();
		}
		const saved = dependencies.save(
			manager,
			CLINE_PROVIDER_ID,
			existing,
			credentials,
		);
		if (saved.provider !== CLINE_PROVIDER_ID) {
			dependencies.markEnabled(manager, CLINE_PROVIDER_ID, {
				tokenSource: "oauth",
			});
		}
		return {
			provider: CLINE_PROVIDER_ID,
			accessToken: saved.auth?.accessToken ?? saved.apiKey ?? "",
		};
	} finally {
		if (pendingDeviceAuthsById.get(authId) === entry) {
			pendingDeviceAuthsById.delete(authId);
		}
	}
}

/**
 * Cancels a pending device sign-in. The abandoned authorization is discarded
 * even if the user later approves the code in an already-open browser tab.
 */
export function cancelClineDeviceAuthFlow(authId: string): boolean {
	const entry = pendingDeviceAuthsById.get(authId);
	if (!entry) {
		return false;
	}
	entry.cancel();
	pendingDeviceAuthsById.delete(authId);
	return true;
}

/**
 * Cancels every pending device sign-in started by a transport connection.
 * Called when that connection closes, so a webview reload or transport drop
 * can never leave a dangling poll that persists credentials later.
 */
export function cancelClineDeviceAuthFlowsForOwner(owner: object): number {
	let cancelled = 0;
	for (const [authId, entry] of pendingDeviceAuthsById) {
		if (entry.owner === owner) {
			entry.cancel();
			pendingDeviceAuthsById.delete(authId);
			cancelled += 1;
		}
	}
	return cancelled;
}
