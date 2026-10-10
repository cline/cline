import { describe, expect, it, vi } from "vitest"
import { getPrivacySettingsClient, getPrivacySettingsUrl } from "./helpers"

vi.mock("@/config/platform.config", () => ({
	PLATFORM_CONFIG: { type: 0 },
	PlatformType: { VSCODE: 0, STANDALONE: 1 },
}))

describe("getPrivacySettingsUrl", () => {
	it("returns undefined when the API did not advertise a path, so nothing renders", () => {
		expect(getPrivacySettingsUrl("https://app.cline.bot", undefined)).toBeUndefined()
		expect(getPrivacySettingsUrl("https://app.cline.bot", "")).toBeUndefined()
	})

	it("joins the advertised path with the app base URL and tags the originating client", () => {
		const url = getPrivacySettingsUrl("https://app.cline.bot", "/dashboard/account?tab=privacy", "vscode")
		expect(url?.href).toBe("https://app.cline.bot/dashboard/account?tab=privacy&client=vscode")
	})

	it("keeps the path's own query string on a base with a trailing slash", () => {
		const url = getPrivacySettingsUrl("https://staging-app.cline.bot/", "/dashboard/account?tab=privacy", "jetbrains")
		expect(url?.origin).toBe("https://staging-app.cline.bot")
		expect(url?.pathname).toBe("/dashboard/account")
		expect(url?.searchParams.get("tab")).toBe("privacy")
		expect(url?.searchParams.get("client")).toBe("jetbrains")
	})

	it("defaults the client to the host this webview runs in", () => {
		expect(getPrivacySettingsClient()).toBe("vscode")
		const url = getPrivacySettingsUrl("https://app.cline.bot", "/dashboard/account?tab=privacy")
		expect(url?.searchParams.get("client")).toBe("vscode")
	})

	it("returns undefined instead of throwing on an unusable base", () => {
		expect(getPrivacySettingsUrl("not a url", "/dashboard/account?tab=privacy", "vscode")).toBeUndefined()
	})
})
