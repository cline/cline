import type {
	ClineAccountActionRequest,
	HubCommandInput,
	HubCommandOutputMap,
	HubOAuthLoginResult,
	HubProviderCommandName,
} from "@cline/shared";
import { createSessionId } from "@cline/shared";
import type { OAuthLoginCallbacks } from "../../auth/types";
import { HubCommandError, type NodeHubClient } from "./index";

/** Browser interactions stay with the client; tokens and callback servers stay in the Hub. */
export function createHubProviderAuthApi(
	client: Pick<NodeHubClient, "command">,
) {
	async function command<T extends HubProviderCommandName>(
		name: T,
		input: HubCommandInput<T>,
	): Promise<HubCommandOutputMap[T]> {
		const reply = await client.command(name, { ...input }, undefined, {
			retryAfterDispatch: false,
			timeoutMs: null,
		});
		if (!reply.ok)
			throw new HubCommandError(
				name,
				reply.error?.code,
				reply.error?.message ?? `Hub command failed: ${name}`,
			);
		return reply.payload as unknown as HubCommandOutputMap[T];
	}
	const cancel = (loginId: string) =>
		command("providers.oauth.cancel", { loginId });
	return {
		cancel,
		account: async (request: ClineAccountActionRequest) =>
			(await command("providers.account.action", request)).result,
		async login(
			providerId: string,
			callbacks: OAuthLoginCallbacks,
			signal?: AbortSignal,
		): Promise<HubOAuthLoginResult> {
			signal?.throwIfAborted();
			const loginId = createSessionId("oauth_");
			let started = false;
			const abort = () => {
				if (started) void cancel(loginId).catch(() => {});
			};
			signal?.addEventListener("abort", abort, { once: true });
			try {
				started = true;
				await command("providers.oauth.start", {
					providerId,
					loginId,
					manualCodeInput: Boolean(callbacks.onManualCodeInput),
				});
				if (signal?.aborted) {
					await cancel(loginId);
					signal.throwIfAborted();
				}
				for (;;) {
					const snapshot = await command("providers.oauth.next", { loginId });
					signal?.throwIfAborted();
					for (const event of snapshot.events) {
						switch (event.kind) {
							case "auth":
								callbacks.onAuth(event);
								break;
							case "user_code":
								callbacks.onUserCode?.(event.userCode);
								break;
							case "progress":
								callbacks.onProgress?.(event.message);
								break;
							case "server_listening":
								await callbacks.onServerListening?.(event);
								break;
							case "server_close":
								await callbacks.onServerClose?.(event);
								break;
							case "prompt": {
								// Manual input can wait while the loopback callback completes. Do not
								// block polling behind an optional prompt that the browser can satisfy.
								void Promise.resolve()
									.then(() =>
										event.manual && callbacks.onManualCodeInput
											? callbacks.onManualCodeInput()
											: callbacks.onPrompt(event),
									)
									.then((value) =>
										command("providers.oauth.respond", {
											loginId,
											promptId: event.promptId,
											value,
										}),
									)
									.catch(() => {
										void cancel(loginId).catch(() => {});
									});
								break;
							}
						}
					}
					if (snapshot.error)
						throw new HubCommandError(
							"providers.oauth.start",
							snapshot.error.code,
							snapshot.error.message,
						);
					if (snapshot.result) return snapshot.result;
				}
			} catch (error) {
				if (started) await cancel(loginId).catch(() => {});
				throw error;
			} finally {
				signal?.removeEventListener("abort", abort);
			}
		},
	};
}
