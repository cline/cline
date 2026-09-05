import { afterEach, describe, expect, it } from "vitest";
import { resolveProviderLocalCli } from "./local-cli";
import { registerProvider, resetRegistry } from "./model-registry";

afterEach(() => {
	resetRegistry();
});

describe("resolveProviderLocalCli", () => {
	it("resolves the CLI and install docs declared by local-auth providers", () => {
		expect(resolveProviderLocalCli("openai-codex-cli")).toEqual({
			command: "codex",
			docsUrl: "https://developers.openai.com/codex/cli",
		});
		expect(resolveProviderLocalCli("claude-code")).toEqual({
			command: "claude",
			docsUrl: "https://code.claude.com/docs/en/setup",
		});
	});

	it("returns undefined for providers that name no local CLI", () => {
		// Including OAuth/API-key providers that carry a docsUrl of their own.
		expect(resolveProviderLocalCli("anthropic")).toBeUndefined();
		expect(resolveProviderLocalCli("openai-codex")).toBeUndefined();
		expect(resolveProviderLocalCli("does-not-exist")).toBeUndefined();
	});

	it("reads the catalog, so registered providers resolve too", () => {
		registerProvider({
			provider: {
				id: "vendor-cli",
				name: "Vendor CLI",
				protocol: "openai-chat",
				client: "openai",
				defaultModelId: "alpha",
				capabilities: ["local-auth"],
				source: "file",
				metadata: { localCliCommand: " vendor " },
			},
			models: { alpha: { id: "alpha", name: "Alpha" } },
		});

		expect(resolveProviderLocalCli("vendor-cli")).toEqual({
			command: "vendor",
			docsUrl: undefined,
		});
	});
});
