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
})
