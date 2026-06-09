import { describe, expect, it } from "vitest"
import { parseProviderId } from "./provider-id"
import { toSdkProviderId } from "./sdk-provider-id"

describe("toSdkProviderId", () => {
	it("maps lowercased extension ids to SDK-specific provider id casing", () => {
		expect(parseProviderId("nousResearch")).toBe("nousresearch")
		expect(toSdkProviderId(parseProviderId("nousResearch"))).toBe("nousResearch")
	})

	it("passes through providers whose SDK id matches extension config casing", () => {
		expect(toSdkProviderId(parseProviderId("openrouter"))).toBe("openrouter")
		expect(toSdkProviderId("huawei-cloud-maas")).toBe("huawei-cloud-maas")
	})

	it("maps the extension's openai alias to the SDK's openai-compatible built-in", () => {
		// The extension stores the OpenAI Compatible provider as "openai"; the
		// SDK registers it as "openai-compatible". Mapping here lets the SDK
		// provider registry recognize it and routes it through the
		// chat-completions client (matching the CLI's provider id).
		expect(toSdkProviderId(parseProviderId("openai"))).toBe("openai-compatible")
		expect(toSdkProviderId("openai")).toBe("openai-compatible")
	})
})
