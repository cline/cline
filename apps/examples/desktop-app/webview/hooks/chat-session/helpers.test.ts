import { describe, expect, it } from "vitest";
import type { ChatSessionConfig } from "@/lib/chat-schema";
import { inferHydratedChatStatus, resolveCredentialError } from "./helpers";

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
