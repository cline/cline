import { getProviderConfigFields, Llms } from "@cline/core";
import { describe, expect, it } from "vitest";
import {
	getLocalCliProvider,
	listLocalCliProviders,
} from "./local-cli-providers";

describe("local CLI providers", () => {
	it("reads the CLI behind each local-auth provider from the provider spec", () => {
		expect(getLocalCliProvider("openai-codex-cli")).toMatchObject({
			cliName: "OpenAI Codex CLI",
			executable: "codex",
			installUrl: "https://developers.openai.com/codex/cli",
		});
		expect(getLocalCliProvider("claude-code")).toMatchObject({
			cliName: "Claude Code",
			executable: "claude",
			installUrl: "https://code.claude.com/docs/en/setup",
		});
	});

	it("ignores providers that authenticate with an API key", () => {
		expect(getLocalCliProvider("anthropic")).toBeUndefined();
		expect(getLocalCliProvider("openai-codex")).toBeUndefined();
	});

	// The setup screen probes `executable`, so a provider marked local-auth
	// without one would render a readiness screen with nothing to check.
	it("gives every local-auth provider an executable to probe", () => {
		const localAuthProviderIds = Object.keys(
			Llms.MODEL_COLLECTIONS_BY_PROVIDER_ID,
		).filter((id) => getProviderConfigFields(id).authMethod === "local");

		expect(localAuthProviderIds.length).toBeGreaterThan(0);
		for (const providerId of localAuthProviderIds) {
			expect(getLocalCliProvider(providerId)?.executable).toBeTruthy();
		}
		expect(
			listLocalCliProviders()
				.map((p) => p.providerId)
				.sort(),
		).toEqual(localAuthProviderIds.sort());
	});
});
