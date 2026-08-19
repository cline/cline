import { getProviderConfigFields, Llms } from "@cline/core";
import { describe, expect, it } from "vitest";
import {
	getLocalCliProvider,
	isLocalCliProvider,
	listLocalCliProviders,
} from "./local-cli-providers";

describe("local CLI providers", () => {
	it("describes the CLI behind each local-auth provider", () => {
		expect(getLocalCliProvider("openai-codex-cli")).toMatchObject({
			cliName: "Codex CLI",
			executable: "codex",
		});
		expect(getLocalCliProvider("claude-code")).toMatchObject({
			cliName: "Claude Code",
			executable: "claude",
		});
	});

	it("ignores providers that authenticate with an API key", () => {
		expect(isLocalCliProvider("anthropic")).toBe(false);
		expect(getLocalCliProvider("openai-codex")).toBeUndefined();
	});

	// The setup screens are keyed off these descriptors, so a provider marked
	// local-auth without one would land in the API-key dialog with no fields.
	it("covers every provider the SDK reports as local auth", () => {
		const localAuthProviderIds = Object.keys(
			Llms.MODEL_COLLECTIONS_BY_PROVIDER_ID,
		).filter((id) => getProviderConfigFields(id).authMethod === "local");

		expect(localAuthProviderIds.length).toBeGreaterThan(0);
		for (const providerId of localAuthProviderIds) {
			expect(isLocalCliProvider(providerId)).toBe(true);
		}
	});

	it("only describes providers the SDK reports as local auth", () => {
		for (const provider of listLocalCliProviders()) {
			expect(getProviderConfigFields(provider.providerId).authMethod).toBe(
				"local",
			);
		}
	});
});
