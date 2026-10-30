import { randomUUID } from "node:crypto";
import type {
	HubOAuthInteraction,
	HubOAuthLoginResult,
	HubOAuthLoginSnapshot,
	ITelemetryService,
} from "@cline/shared";
import { getProviderAuthHandler } from "../../auth/provider-auth-registry";
import {
	markLocalProviderEnabled,
	normalizeOAuthProvider,
} from "../../services/providers/local-provider-service";
import { ProviderSettingsManager } from "../../services/storage/provider-settings-manager";

type Attempt = {
	id: string;
	owner: string;
	providerId: string;
	storageId: string;
	controller: AbortController;
	events: HubOAuthInteraction[];
	result?: HubOAuthLoginResult;
	error?: { code: string; message: string };
	wake?: () => void;
	prompts: Map<string, (value: string) => void>;
};

/** Owns authorization, callback servers, cancellation and credential persistence. */
export class HubProviderAuthService {
	private readonly attempts = new Map<string, Attempt>();
	private readonly active = new Set<string>();
	private readonly runs = new Set<Promise<void>>();
	constructor(private readonly telemetry?: ITelemetryService) {}
	get activeCount(): number {
		return this.active.size;
	}
	start(
		owner: string,
		input: { providerId: string; loginId: string; manualCodeInput?: boolean },
	) {
		if (this.attempts.has(input.loginId))
			throw new Error("Login id is already in use");
		const providerId = normalizeOAuthProvider(input.providerId);
		const handler = getProviderAuthHandler(providerId);
		if (!handler) throw new Error("Provider does not support OAuth");
		const manager = new ProviderSettingsManager();
		const existing = manager.getProviderSettings(handler.storageProviderId);
		for (const entry of this.attempts.values()) {
			if (
				entry.storageId === handler.storageProviderId &&
				this.active.has(entry.id)
			)
				this.cancelAttempt(entry);
		}
		const entry: Attempt = {
			id: input.loginId,
			owner,
			providerId,
			storageId: handler.storageProviderId,
			controller: new AbortController(),
			events: [],
			prompts: new Map(),
		};
		this.attempts.set(entry.id, entry);
		this.active.add(entry.id);
		const timer = setTimeout(() => this.cancelAttempt(entry), 10 * 60_000);
		timer.unref?.();
		const emit = (event: HubOAuthInteraction) => {
			entry.controller.signal.throwIfAborted();
			if (entry.events.length >= 100)
				throw new Error("OAuth interaction queue is full");
			entry.events.push(event);
			entry.wake?.();
		};
		const prompt = (message: string, defaultValue?: string, manual = false) =>
			new Promise<string>((resolve, reject) => {
				if (entry.controller.signal.aborted) {
					reject(entry.controller.signal.reason);
					return;
				}
				const promptId = randomUUID();
				const abortPrompt = () => reject(entry.controller.signal.reason);
				entry.controller.signal.addEventListener("abort", abortPrompt, {
					once: true,
				});
				entry.prompts.set(promptId, (value) => {
					entry.controller.signal.removeEventListener("abort", abortPrompt);
					resolve(value);
				});
				emit({ kind: "prompt", promptId, message, defaultValue, manual });
			});
		const cancelled = new Promise<never>((_, reject) => {
			entry.controller.signal.addEventListener(
				"abort",
				() => reject(entry.controller.signal.reason),
				{ once: true },
			);
		});
		const run = Promise.race([
			Promise.resolve().then(() =>
				handler.login({
					settings: existing,
					signal: entry.controller.signal,
					telemetry: this.telemetry,
					callbacks: {
						onAuth: (info) => emit({ kind: "auth", ...info }),
						onUserCode: (userCode) => emit({ kind: "user_code", userCode }),
						onProgress: (message) => emit({ kind: "progress", message }),
						onPrompt: ({ message, defaultValue }) =>
							prompt(message, defaultValue),
						...(input.manualCodeInput
							? {
									onManualCodeInput: () =>
										prompt(
											"Paste the authorization code or redirect URL:",
											undefined,
											true,
										),
								}
							: {}),
						onServerListening: (info) =>
							emit({ kind: "server_listening", ...info }),
						onServerClose: (info) => {
							if (!entry.controller.signal.aborted)
								emit({ kind: "server_close", ...info });
						},
					},
				}),
			),
			cancelled,
		])
			.then((credentials) => {
				entry.controller.signal.throwIfAborted();
				const current = manager.getProviderSettings(entry.storageId);
				if (
					current?.auth?.accessToken !== existing?.auth?.accessToken ||
					current?.auth?.refreshToken !== existing?.auth?.refreshToken ||
					current?.auth?.accountId !== existing?.auth?.accountId ||
					current?.apiKey !== existing?.apiKey ||
					current?.baseUrl !== existing?.baseUrl
				)
					throw new Error("Provider credentials changed during sign-in");
				const saved = handler.saveCredentials({
					manager,
					settings: existing,
					credentials,
				});
				if (saved.provider !== providerId)
					markLocalProviderEnabled(manager, providerId, {
						tokenSource: "oauth",
					});
				entry.result = {
					provider: providerId,
					accountId: credentials.accountId,
					email: credentials.email,
				};
			})
			.catch((error) => {
				entry.error = {
					code: entry.controller.signal.aborted
						? "oauth_cancelled"
						: "oauth_failed",
					message: error instanceof Error ? error.message : String(error),
				};
			})
			.finally(() => {
				clearTimeout(timer);
				this.active.delete(entry.id);
				entry.prompts.clear();
				entry.wake?.();
				// An abandoned client must not retain its terminal snapshots indefinitely.
				const expiry = setTimeout(() => {
					if (this.attempts.get(entry.id) === entry)
						this.attempts.delete(entry.id);
				}, 60_000);
				expiry.unref?.();
			});
		this.runs.add(run);
		void run.then(() => this.runs.delete(run));
		return { loginId: entry.id };
	}
	private owned(owner: string, id: string): Attempt {
		const entry = this.attempts.get(id);
		if (!entry || entry.owner !== owner)
			throw new Error("OAuth login does not belong to this client");
		return entry;
	}
	async next(owner: string, id: string): Promise<HubOAuthLoginSnapshot> {
		const entry = this.owned(owner, id);
		if (entry.wake) throw new Error("Only one OAuth poll may be pending");
		if (!entry.events.length && !entry.result && !entry.error) {
			await new Promise<void>((resolve) => {
				const timer = setTimeout(() => {
					entry.wake = undefined;
					resolve();
				}, 25_000);
				entry.wake = () => {
					clearTimeout(timer);
					entry.wake = undefined;
					resolve();
				};
			});
		}
		return {
			events: entry.events.splice(0),
			result: entry.result,
			error: entry.error,
		};
	}
	respond(owner: string, id: string, promptId: string, value: string) {
		const entry = this.owned(owner, id);
		const resolve = entry.prompts.get(promptId);
		entry.prompts.delete(promptId);
		resolve?.(value);
		return { applied: Boolean(resolve) };
	}
	private cancelAttempt(entry: Attempt) {
		if (!this.active.has(entry.id)) return false;
		entry.controller.abort(
			new Error(`Sign-in was cancelled for provider "${entry.providerId}"`),
		);
		entry.wake?.();
		return true;
	}
	cancel(owner: string, id: string) {
		return { cancelled: this.cancelAttempt(this.owned(owner, id)) };
	}
	cancelOwner(owner: string) {
		for (const entry of this.attempts.values())
			if (entry.owner === owner) {
				this.cancelAttempt(entry);
				this.attempts.delete(entry.id);
			}
	}
	cancelProvider(providerId: string) {
		const storageId =
			getProviderAuthHandler(providerId)?.storageProviderId ?? providerId;
		for (const entry of this.attempts.values())
			if (entry.storageId === storageId) this.cancelAttempt(entry);
	}
	async dispose() {
		for (const entry of this.attempts.values()) this.cancelAttempt(entry);
		await Promise.allSettled(this.runs);
		this.attempts.clear();
	}
}
