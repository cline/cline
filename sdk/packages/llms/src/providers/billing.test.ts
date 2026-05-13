import { describe, expect, it } from "vitest";
import {
	resolveProviderUsageCostDisplay,
	shouldShowProviderUsageCost,
} from "./billing";
import { getProviderCollectionSync } from "./model-registry";

describe("provider usage cost display", () => {
	it("hides usage cost for subscription-backed Codex providers", () => {
		expect(resolveProviderUsageCostDisplay("openai-codex")).toBe("hide");
		expect(resolveProviderUsageCostDisplay("openai-codex-cli")).toBe("hide");
		expect(shouldShowProviderUsageCost("openai-codex")).toBe(false);
		expect(shouldShowProviderUsageCost("openai-codex-cli")).toBe(false);
	});

	it("shows usage cost by default for usage-billed providers", () => {
		expect(resolveProviderUsageCostDisplay("openai-native")).toBe("show");
		expect(resolveProviderUsageCostDisplay("anthropic")).toBe("show");
		expect(resolveProviderUsageCostDisplay("cline")).toBe("show");
		expect(shouldShowProviderUsageCost("anthropic")).toBe(true);
	});

	it("stores the display policy on provider metadata", () => {
		expect(
			getProviderCollectionSync("openai-codex")?.provider.metadata,
		).toMatchObject({ usageCostDisplay: "hide" });
	});
});
