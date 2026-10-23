/**
 * Cloud sign-in and cross-account session discovery. Retired device-code flows
 * must neither persist credentials nor overwrite a newer attempt's state.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
	CloudSessionApiError,
	CloudSessionGateway,
	cloudAuthStore,
	completeClineDeviceAuth,
	GitHubIntegrationRequiredError,
	startClineDeviceAuth,
} from "@/cloud";
import { CloudAccountGateway } from "@/cloud/rest/CloudAccountGateway";
import { cloudEnv } from "@/config/env";
import { cloudLaunches } from "@/connection/cloud-launches";
import { errorDetail } from "@/error-message";
import type { RemoteSession } from "@/session";
import { useCloudAccountScope } from "@/state/cloud-auth";

const NO_ORGANIZATION_IDS: readonly string[] = [];

export type CloudSessionsState =
	/** No usable credentials on this device. */
	| { phase: "signed-out" }
	/** Asking WorkOS for a device code. */
	| { phase: "starting" }
	/** Waiting for the user to finish in the browser. */
	| {
			phase: "authorizing";
			userCode: string;
			verificationUrl: string;
			/** False when the URL failed the scheme allowlist — show it, don't open it. */
			openable: boolean;
	  }
	/** Signed in; fetching the list. */
	| {
			phase: "loading";
			sessions?: RemoteSession[];
			/** A valid account token is known even if the list refresh is pending. */
			authenticated?: boolean;
	  }
	| { phase: "ready"; sessions: RemoteSession[] }
	/** `message` is user-facing; `detail` is the raw diagnostic. */
	| {
			phase: "error";
			message: string;
			detail?: string;
			/** Whether the next useful action is a retry or fresh authentication. */
			recovery: "retry" | "sign-in";
			authenticated?: boolean;
			/** Last successful list, retained through a transient refresh failure. */
			sessions?: RemoteSession[];
	  };

export interface UseCloudSessions {
	state: CloudSessionsState;
	/** Start (or restart) the device-code sign-in. */
	signIn(): void;
	/** Re-fetch the list with the credentials already on the device. */
	refresh(): void;
}

export function getCloudSessions(state: CloudSessionsState) {
	return "sessions" in state ? state.sessions : undefined;
}

/**
 * Turn a thrown error into a sentence a person can act on, keeping the raw text
 * (`Token registration failed: 500 - <server body>`) as a separate diagnostic
 * line instead of making it the headline.
 */
export function describeCloudError(error: unknown): {
	message: string;
	detail?: string;
	recovery: "retry" | "sign-in";
} {
	const detail = errorDetail(error);
	if (error instanceof GitHubIntegrationRequiredError) {
		return {
			message:
				"Connect GitHub to your Cline account on the web, then try again.",
			detail,
			recovery: "retry",
		};
	}
	if (error instanceof CloudSessionApiError) {
		if (error.status === 401) {
			return {
				message: "Your Cline session has expired. Sign in again.",
				detail,
				recovery: "sign-in",
			};
		}
		return {
			message: "Cline Cloud could not be reached. Please try again.",
			detail,
			recovery: "retry",
		};
	}
	return {
		message: "Something went wrong with Cline Cloud.",
		detail,
		recovery: "retry",
	};
}

export interface UseCloudSessionsOptions {
	/**
	 * Opens the WorkOS verification page. The caller owns the allowlist decision
	 * (and may decline), so this hook never reaches `Linking` itself.
	 */
	openVerificationUrl(url: string): boolean;
	/** Skip the initial load — used by a signed-out-only surface in tests. */
	autoLoad?: boolean;
	/** Organization scopes already configured on this device. */
	organizationIds?: readonly string[];
	/** Refresh visible history quietly; never poll while the app is backgrounded. */
	refreshIntervalMs?: number;
}

function logCloudFailure(scope: "load" | "sign-in", error: unknown): void {
	// Release-device diagnostics must never serialize request objects or headers:
	// those may contain the account token. Error name/message/status are sufficient
	// to distinguish transport, auth, and response-contract failures.
	const status =
		typeof error === "object" &&
		error !== null &&
		"status" in error &&
		typeof error.status === "number"
			? error.status
			: undefined;
	console.error(`[mobile/cloud] ${scope} failed`, {
		name: error instanceof Error ? error.name : typeof error,
		message: errorDetail(error),
		status,
	});
}

export function useCloudSessions({
	openVerificationUrl,
	autoLoad = true,
	organizationIds = NO_ORGANIZATION_IDS,
	refreshIntervalMs,
}: UseCloudSessionsOptions): UseCloudSessions {
	const { beginRefresh } = useCloudAccountScope();
	// Boots as "loading", not "signed-out": the first token check has not run
	// yet, and claiming signed-out for that window flashes sign-in UI (and the
	// onboarding gate) at users who are in fact signed in.
	const [state, setState] = useState<CloudSessionsState>({
		phase: "loading",
		sessions: [],
	});
	const lastSessions = useRef<RemoteSession[]>([]);
	const lastAuthenticated = useRef(false);
	const loading = useRef(false);

	/**
	 * Supersedes in-flight cloud work: the device-code poll runs for minutes, so a
	 * second sign-in — or an unmount — must retire the previous attempt.
	 */
	const flow = useRef(0);
	const startFlow = useCallback((): number => {
		flow.current += 1;
		return flow.current;
	}, []);
	const isCurrentFlow = useCallback(
		(generation: number) => flow.current === generation,
		[],
	);
	// Unmounting is a cancellation too (a ref needs no dependency list).
	useEffect(
		() => () => {
			flow.current += 1;
		},
		[],
	);

	const load = useCallback(
		async (generation: number) => {
			loading.current = true;
			const publishScope = beginRefresh();
			setState({
				phase: "loading",
				sessions: lastSessions.current,
				authenticated: lastAuthenticated.current,
			});
			try {
				const token = await cloudAuthStore.getValidAccessToken();
				if (!isCurrentFlow(generation)) {
					return;
				}
				if (!token) {
					lastSessions.current = [];
					lastAuthenticated.current = false;
					setState({ phase: "signed-out" });
					return;
				}
				lastAuthenticated.current = true;
				const accounts = await new CloudAccountGateway({
					apiBaseUrl: cloudEnv.apiBaseUrl,
					getAccessToken: () => cloudAuthStore.getValidAccessToken(),
				}).listAccounts();
				if (!isCurrentFlow(generation)) return;
				publishScope({
					organizationId: accounts.find((account) => account.active)
						?.organizationId,
				});
				setState({
					phase: "loading",
					authenticated: true,
					sessions: lastSessions.current,
				});
				const scopes = [
					// Session history remains cross-account; only new-work defaults are scoped.
					undefined,
					...new Set([
						...organizationIds,
						...accounts.flatMap((account) =>
							account.organizationId ? [account.organizationId] : [],
						),
					]),
				] as const;
				const results = await Promise.allSettled(
					scopes.map((organizationId) =>
						new CloudSessionGateway({
							apiBaseUrl: cloudEnv.apiBaseUrl,
							getAccessToken: () => cloudAuthStore.getValidAccessToken(),
							...(organizationId ? { organizationId } : {}),
						}).listRemoteSessions({ refreshProvisioning: true }),
					),
				);
				const personal = results[0];
				if (!personal || personal.status === "rejected") {
					throw (
						personal?.reason ?? new Error("Personal Cloud session load failed.")
					);
				}
				for (const result of results.slice(1)) {
					if (result.status === "rejected") {
						logCloudFailure("load", result.reason);
					}
				}
				const scopedSessions = results.flatMap((result) =>
					result.status === "fulfilled" ? [result.value] : [],
				);
				const sessions = [
					...new Map(
						scopedSessions
							.flat()
							.map((session) => [
								`${session.organizationId ?? "personal"}:${session.id}`,
								session,
							]),
					).values(),
				];
				if (!isCurrentFlow(generation)) {
					return;
				}
				lastSessions.current = sessions;
				cloudLaunches.reconcile(sessions);
				setState({ phase: "ready", sessions });
			} catch (error) {
				if (!isCurrentFlow(generation)) {
					return;
				}
				logCloudFailure("load", error);
				const described = describeCloudError(error);
				if (described.recovery === "sign-in") {
					lastSessions.current = [];
					lastAuthenticated.current = false;
				}
				setState({
					phase: "error",
					...described,
					sessions: lastSessions.current,
					authenticated: lastAuthenticated.current,
				});
			} finally {
				if (isCurrentFlow(generation)) loading.current = false;
			}
		},
		[isCurrentFlow, organizationIds, beginRefresh],
	);

	const refresh = useCallback(() => {
		void load(startFlow());
	}, [load, startFlow]);

	const signIn = useCallback(() => {
		const generation = startFlow();
		lastAuthenticated.current = false;
		setState({ phase: "starting" });
		void (async () => {
			try {
				const authorization = await startClineDeviceAuth({
					workOsClientId: cloudEnv.workOsClientId,
					// Client id and api base from ONE environment; the SDK rejects a
					// cross-environment pair rather than signing in against the wrong host.
					apiBaseUrl: cloudEnv.apiBaseUrl,
					workOsBaseUrl: cloudEnv.workOsBaseUrl,
				});
				if (!isCurrentFlow(generation)) {
					return;
				}
				const verificationUrl =
					authorization.verificationUriComplete ??
					authorization.verificationUri;
				const openable = openVerificationUrl(verificationUrl);
				setState({
					phase: "authorizing",
					userCode: authorization.userCode,
					verificationUrl,
					openable,
				});
				const credentials = await completeClineDeviceAuth({
					deviceCode: authorization.deviceCode,
					expiresInSeconds: authorization.expiresInSeconds,
					pollIntervalSeconds: authorization.pollIntervalSeconds,
					apiBaseUrl: cloudEnv.apiBaseUrl,
					provider: "cline",
					workOsClientId: cloudEnv.workOsClientId,
					workOsBaseUrl: cloudEnv.workOsBaseUrl,
				});
				if (!isCurrentFlow(generation)) {
					// Abandoned attempt: do NOT persist credentials it just minted.
					return;
				}
				await cloudAuthStore.setCredentials(credentials);
				await load(generation);
			} catch (error) {
				if (!isCurrentFlow(generation)) {
					return;
				}
				logCloudFailure("sign-in", error);
				setState({ phase: "error", ...describeCloudError(error) });
			}
		})();
	}, [isCurrentFlow, load, openVerificationUrl, startFlow]);

	// One load on mount: a returning signed-in user lands on their sessions, and a
	// signed-out one lands on the sign-in copy without a round trip.
	const loadedScopeKey = useRef<string | undefined>(undefined);
	const scopeKey = organizationIds.join("\u0000");
	useEffect(() => {
		if (!autoLoad || loadedScopeKey.current === scopeKey) {
			return;
		}
		loadedScopeKey.current = scopeKey;
		void load(startFlow());
	}, [autoLoad, load, scopeKey, startFlow]);
	const refreshRef = useRef(refresh);
	refreshRef.current = refresh;
	useEffect(() => {
		if (!autoLoad || !refreshIntervalMs) return;
		const refreshIfIdle = () => {
			if (
				AppState.currentState === "active" &&
				!loading.current &&
				lastAuthenticated.current
			)
				refreshRef.current();
		};
		const timer = setInterval(refreshIfIdle, refreshIntervalMs);
		refreshIfIdle();
		const subscription = AppState.addEventListener("change", (state) => {
			if (state === "active") refreshIfIdle();
		});
		return () => {
			clearInterval(timer);
			subscription.remove();
		};
	}, [autoLoad, refreshIntervalMs]);

	return { state, signIn, refresh };
}
