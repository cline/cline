import { describe, expect, it } from "vitest";
import type { ChatSessionConfig } from "@/lib/chat-schema";
import {
	extractAssistantTurnDataFromRpcMessages,
	inferHydratedChatStatus,
	resolveCredentialError,
} from "./helpers";

function makeConfig(overrides: Partial<ChatSessionConfig>): ChatSessionConfig {
	return {
		workspaceRoot: "/tmp/project",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		mode: "act",
		apiKey: "",
		enableTools: true,
		...overrides,
	};
}

describe("resolveCredentialError", () => {
	it("requires a provider", () => {
		expect(resolveCredentialError(makeConfig({ provider: "  " }))).toMatch(
			/Provider is required/,
		);
	});

	it("blocks API-key providers without a key", () => {
		expect(
			resolveCredentialError(makeConfig({ provider: "anthropic" })),
		).toMatch(/Missing API key/);
	});

	it("allows API-key providers with a key", () => {
		expect(
			resolveCredentialError(
				makeConfig({ provider: "anthropic", apiKey: "sk-123" }),
			),
		).toBeNull();
	});

	it.each([
		"cline",
		"cline-pass",
		"oca",
		"openai-codex",
	])("allows OAuth-managed provider %s without a visible API key", (provider) => {
		// OAuth credentials live in the backend provider settings store
		// (ClinePass shares the Cline account login), never in the webview
		// config, so the pre-flight gate must not demand an API key.
		expect(resolveCredentialError(makeConfig({ provider }))).toBeNull();
	});

	it.each([
		"claude-code",
		"openai-codex-cli",
	])("allows local-auth provider %s without an API key", (provider) => {
		// Local CLI providers authenticate from the CLI's own credential
		// store; the catalog marks them `local-auth` and the key is inert.
		expect(resolveCredentialError(makeConfig({ provider }))).toBeNull();
	});

	it("allows a catalog-declared OAuth provider outside the fallback id set", () => {
		expect(
			resolveCredentialError(makeConfig({ provider: "opencode" })),
		).toBeNull();
	});

	it("treats provider ids case-insensitively", () => {
		expect(
			resolveCredentialError(makeConfig({ provider: "Cline-Pass" })),
		).toBeNull();
	});
});

describe("inferHydratedChatStatus", () => {
	it("treats an assistant-answered running record as completed", () => {
		// The stale-record heuristic: a "running" record whose transcript
		// ends on an assistant answer is read as a session that died without
		// a status flip. (The stale-stream poll deliberately bypasses this
		// via mapSessionRecordStatus — see use-chat-session.)
		expect(
			inferHydratedChatStatus("running", [
				{
					id: "u",
					sessionId: "s",
					role: "user",
					content: "prompt",
					createdAt: 1,
				},
				{
					id: "a",
					sessionId: "s",
					role: "assistant",
					content: "answer",
					createdAt: 2,
				},
			]),
		).toBe("completed");
	});
});

describe("extractAssistantTurnDataFromRpcMessages", () => {
	it("does not render a display-only error as an assistant response", () => {
		expect(
			extractAssistantTurnDataFromRpcMessages([
				{ role: "user", content: "hi" },
				{
					role: "assistant",
					content: "API key expired.",
					metadata: { displayOnly: true, displayRole: "error" },
				},
			]),
		).toEqual({
			text: "",
			reasoning: "",
			reasoningRedacted: false,
			images: [],
			media: [],
		});
	});
});
