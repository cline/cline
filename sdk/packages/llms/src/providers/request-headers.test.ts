import { describe, expect, it } from "vitest";
import { resolveProviderRequestHeaders } from "./request-headers";

function jwtWithPayload(payload: Record<string, unknown>): string {
	return `header.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}.sig`;
}

describe("resolveProviderRequestHeaders", () => {
	it("adds required Cline billing headers after stored, config, and session layers", () => {
		const headers = resolveProviderRequestHeaders({
			providerId: "cline",
			sessionId: "sess-1",
			source: "cli",
			defaultSource: "core",
			client: {
				name: "cline-cli",
				version: "3.0.38",
			},
			coreVersion: "0.2.0",
			headers: {
				stored: {
					"X-CLIENT-TYPE": "stored-client",
					"x-stored": "stored",
					"x-shared": "stored-loses",
				},
				config: {
					"X-Task-ID": "config-task",
					"x-config": "config",
					"x-shared": "config-wins",
				},
				session: {
					"X-CLIENT-VERSION": "session-version",
					"x-session": "session",
				},
			},
		});

		expect(headers).toMatchObject({
			"HTTP-Referer": "https://cline.bot",
			"X-Title": "Cline",
			"User-Agent": "Cline/3.0.38",
			"X-IS-MULTIROOT": "false",
			"X-CLIENT-TYPE": "cline-cli",
			"X-CLIENT-VERSION": "3.0.38",
			"X-PLATFORM": "cli",
			"X-PLATFORM-VERSION": "3.0.38",
			"X-CORE-VERSION": "0.2.0",
			"X-Task-ID": "sess-1",
			"x-config": "config",
			"x-session": "session",
			"x-shared": "config-wins",
			"x-stored": "stored",
		});
	});

	it("uses host client context for Cline billing headers when provided", () => {
		const headers = resolveProviderRequestHeaders({
			providerId: "cline-pass",
			sessionId: "sess-vscode",
			source: "core",
			defaultSource: "core",
			client: {
				name: "VSCode Extension",
				version: "9.9.9",
				platform: "Visual Studio Code",
				platformVersion: "1.103.0",
				isMultiRoot: true,
			},
			coreVersion: "0.2.0",
		});

		expect(headers).toMatchObject({
			"User-Agent": "Cline/9.9.9",
			"X-IS-MULTIROOT": "true",
			"X-CLIENT-TYPE": "VSCode Extension",
			"X-CLIENT-VERSION": "9.9.9",
			"X-PLATFORM": "Visual Studio Code",
			"X-PLATFORM-VERSION": "1.103.0",
			"X-CORE-VERSION": "0.2.0",
			"X-Task-ID": "sess-vscode",
		});
	});

	it("adds OpenAI Codex headers and derives the account id from the access token", () => {
		const token = jwtWithPayload({
			"https://api.openai.com/auth": {
				chatgpt_account_id: "acct-derived",
			},
		});

		const headers = resolveProviderRequestHeaders({
			providerId: "openai-codex",
			sessionId: "sess-codex",
			defaultSource: "cli",
			coreVersion: "0.2.0",
			openAiCodex: {
				accessToken: token,
				userAgentVersion: "3.0.38",
			},
			headers: {
				stored: {
					originator: "stored-originator",
					"x-stored": "stored",
				},
				config: {
					session_id: "config-session",
					"x-config": "config",
				},
			},
		});

		expect(headers).toMatchObject({
			originator: "cline",
			session_id: "sess-codex",
			"User-Agent": "Cline/3.0.38",
			"ChatGPT-Account-Id": "acct-derived",
			"x-config": "config",
			"x-stored": "stored",
		});
	});

	it("adds a request-scoped LiteLLM trace id for OpenAI-compatible providers", () => {
		expect(
			resolveProviderRequestHeaders({
				providerId: "openai-compatible",
				sessionId: "session-a",
				defaultSource: "cli",
				coreVersion: "0.2.0",
			}),
		).toEqual({ "x-litellm-trace-id": "session-a" });
	});

	it("keeps interleaved OpenAI-compatible sessions correlated independently", () => {
		const sessionA = resolveProviderRequestHeaders({
			providerId: "openai-compatible",
			sessionId: "session-a",
			defaultSource: "cli",
			coreVersion: "0.2.0",
		});
		const sessionB = resolveProviderRequestHeaders({
			providerId: "openai-compatible",
			sessionId: "session-b",
			defaultSource: "cli",
			coreVersion: "0.2.0",
		});
		const sessionAAgain = resolveProviderRequestHeaders({
			providerId: "openai-compatible",
			sessionId: "session-a",
			defaultSource: "cli",
			coreVersion: "0.2.0",
		});

		expect(sessionA?.["x-litellm-trace-id"]).toBe("session-a");
		expect(sessionB?.["x-litellm-trace-id"]).toBe("session-b");
		expect(sessionAAgain?.["x-litellm-trace-id"]).toBe("session-a");
	});

	it("does not add or override LiteLLM trace ids for other providers", () => {
		expect(
			resolveProviderRequestHeaders({
				providerId: "anthropic",
				sessionId: "session-anthropic",
				defaultSource: "cli",
				coreVersion: "0.2.0",
				headers: {
					config: { "x-litellm-trace-id": "configured-trace" },
				},
			}),
		).toEqual({ "x-litellm-trace-id": "configured-trace" });
	});

	it("gives the current session id precedence over configured trace headers", () => {
		const headers = resolveProviderRequestHeaders({
			providerId: "openai-compatible",
			sessionId: "session-current",
			defaultSource: "cli",
			coreVersion: "0.2.0",
			headers: {
				stored: { "X-LiteLLM-Trace-ID": "stored-trace" },
				config: { "x-litellm-trace-id": "configured-trace" },
				session: { "X-LITELLM-TRACE-ID": "session-trace" },
			},
		});

		expect(headers).toEqual({ "x-litellm-trace-id": "session-current" });
		expect(
			Object.keys(headers ?? {}).filter(
				(key) => key.toLowerCase() === "x-litellm-trace-id",
			),
		).toEqual(["x-litellm-trace-id"]);
	});

	it("preserves existing precedence for providers without required headers", () => {
		expect(
			resolveProviderRequestHeaders({
				providerId: "anthropic",
				sessionId: "sess-plain",
				defaultSource: "cli",
				coreVersion: "0.2.0",
				headers: {
					stored: { "x-stored": "stored" },
					config: { "x-config": "config" },
				},
			}),
		).toEqual({ "x-config": "config" });

		expect(
			resolveProviderRequestHeaders({
				providerId: "anthropic",
				sessionId: "sess-plain",
				defaultSource: "cli",
				coreVersion: "0.2.0",
				headers: {
					stored: { "x-stored": "stored" },
					config: { "x-config": "config" },
					session: { "x-session": "session" },
				},
			}),
		).toEqual({ "x-session": "session" });
	});
});
