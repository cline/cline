import { beforeEach, describe, expect, it, vi } from "vitest"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import { getClineUris, getPrivacySettingsUrl } from "./helpers"

vi.mock("@/config/platform.config", () => ({
	PLATFORM_CONFIG: { type: 0 },
	PlatformType: { VSCODE: 0, STANDALONE: 1 },
}))

const dataPrivacyPath = "/dashboard/account?tab=privacy"

describe("getPrivacySettingsUrl", () => {
	beforeEach(() => {
		vi.mocked(PLATFORM_CONFIG).type = PlatformType.VSCODE
	})

	it("renders nothing without a signed-in user's privacy path", () => {
		expect(getPrivacySettingsUrl(null)).toBeUndefined()
		expect(getPrivacySettingsUrl({ appBaseUrl: "https://app.cline.bot" })).toBeUndefined()
	})

	it("renders nothing when the user has no app base URL", () => {
		expect(getPrivacySettingsUrl({ dataPrivacyPath })).toBeUndefined()
	})

	it("opens the user's app as JetBrains inside the JetBrains plugin", () => {
		vi.mocked(PLATFORM_CONFIG).type = PlatformType.STANDALONE
		expect(getPrivacySettingsUrl({ dataPrivacyPath, appBaseUrl: "https://staging-app.cline.bot" })).toBe(
			"https://staging-app.cline.bot/dashboard/account?tab=privacy&client=cline-jetbrains",
		)
	})
})

describe("getClineUris", () => {
	beforeEach(() => {
		vi.mocked(PLATFORM_CONFIG).type = PlatformType.VSCODE
	})

	it("attributes the dashboard link to the extension", () => {
		expect(getClineUris("https://app.cline.bot", "dashboard")).toBe("https://app.cline.bot/dashboard?client=cline-vscode")
	})

	it("renders nothing when the user has no app base URL", () => {
		expect(getClineUris(undefined, "dashboard")).toBeUndefined()
	})

	it("keeps the credits tab and redirect on the organization route", () => {
		expect(getClineUris("https://staging-app.cline.bot", "credits", "organization")).toBe(
			"https://staging-app.cline.bot/organization?tab=credits&redirect=true&client=cline-vscode",
		)
	})
})
