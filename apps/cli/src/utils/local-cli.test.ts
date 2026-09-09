import { isLocalAuthProvider } from "@cline/core";
import { describe, expect, it } from "vitest";
import { getLocalCliInfo } from "./local-cli";

describe("local CLI providers", () => {
	it("reads the CLI a local-auth provider borrows credentials from", () => {
		expect(getLocalCliInfo("openai-codex-cli")).toEqual({
			command: "codex",
			docsUrl: "https://developers.openai.com/codex/cli",
		});
		expect(getLocalCliInfo("claude-code")).toEqual({
			command: "claude",
			docsUrl: "https://code.claude.com/docs/en/setup",
		});
	});

	it("names no CLI for providers that authenticate with an API key", () => {
		expect(getLocalCliInfo("anthropic")).toBeUndefined();
		expect(getLocalCliInfo("openai-codex")).toBeUndefined();
	});

	// Routing is keyed off the capability alone, so a local-auth provider whose
	// credentials come from somewhere unprobeable still reaches the local setup
	// screen instead of an empty API-key form.
	it("routes on the capability, not on knowing a CLI", () => {
		expect(isLocalAuthProvider("claude-code")).toBe(true);
		expect(isLocalAuthProvider("openai-codex-cli")).toBe(true);
		expect(isLocalAuthProvider("anthropic")).toBe(false);
	});
});
