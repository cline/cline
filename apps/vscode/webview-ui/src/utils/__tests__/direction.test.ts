import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	DEFAULT_APP_DIRECTION,
	DIRECTION_STORAGE_KEY,
	isAppDirection,
	isRtlLanguageTag,
	readAppliedDirection,
	readStoredDirection,
	resolveDirection,
	setStoredDirection,
	subscribeToDirection,
	syncDirection,
} from "../direction"

function setPreferredLanguages(languages: string[]) {
	Object.defineProperty(window.navigator, "languages", {
		configurable: true,
		value: languages,
	})
	Object.defineProperty(window.navigator, "language", {
		configurable: true,
		value: languages[0] ?? "en",
	})
}

beforeEach(() => {
	window.localStorage.clear()
	setPreferredLanguages(["en-US"])
	document.documentElement.dir = "ltr"
	delete document.documentElement.dataset.clineDirection
})

afterEach(() => {
	// Drop the per-test overrides so later suites see the jsdom defaults again.
	delete (window.navigator as { languages?: unknown }).languages
	delete (window.navigator as { language?: unknown }).language
})

describe("direction", () => {
	it("defaults to auto and resolves the direction from language tags", () => {
		expect(readStoredDirection()).toBe(DEFAULT_APP_DIRECTION)
		expect(DEFAULT_APP_DIRECTION).toBe("auto")

		expect(isAppDirection("rtl")).toBe(true)
		expect(isAppDirection("auto")).toBe(true)
		expect(isAppDirection("sideways")).toBe(false)

		expect(isRtlLanguageTag("fa")).toBe(true)
		expect(isRtlLanguageTag("fa-IR")).toBe(true)
		expect(isRtlLanguageTag("AR_EG")).toBe(true)
		expect(isRtlLanguageTag("he")).toBe(true)
		expect(isRtlLanguageTag("en-US")).toBe(false)

		expect(resolveDirection("auto", ["en-US"])).toBe("ltr")
		expect(resolveDirection("auto", ["fa-IR"])).toBe("rtl")
		expect(resolveDirection("auto", ["en-US", "ar"])).toBe("rtl")
		// Explicit choices win over the system language.
		expect(resolveDirection("ltr", ["fa-IR"])).toBe("ltr")
		expect(resolveDirection("rtl", ["en-US"])).toBe("rtl")
	})

	it("persists the preference and applies the resolved direction to <html>", () => {
		expect(setStoredDirection("rtl")).toBe("rtl")
		expect(window.localStorage.getItem(DIRECTION_STORAGE_KEY)).toBe("rtl")
		expect(document.documentElement.dir).toBe("rtl")
		expect(document.documentElement.dataset.clineDirection).toBe("rtl")
		expect(readAppliedDirection()).toBe("rtl")

		// "auto" stores the preference but applies the system language.
		setPreferredLanguages(["fa-IR"])
		expect(setStoredDirection("auto")).toBe("rtl")
		expect(window.localStorage.getItem(DIRECTION_STORAGE_KEY)).toBe("auto")
		expect(readStoredDirection()).toBe("auto")
		expect(document.documentElement.dir).toBe("rtl")

		setPreferredLanguages(["en-US"])
		expect(setStoredDirection("auto")).toBe("ltr")
		expect(document.documentElement.dir).toBe("ltr")
		expect(readAppliedDirection()).toBe("ltr")
	})

	it("applies the stored preference on sync and ignores unusable values", () => {
		window.localStorage.setItem(DIRECTION_STORAGE_KEY, "rtl")
		expect(readStoredDirection()).toBe("rtl")
		expect(syncDirection()).toBe("rtl")
		expect(document.documentElement.dir).toBe("rtl")

		window.localStorage.setItem(DIRECTION_STORAGE_KEY, "diagonal")
		expect(readStoredDirection()).toBe("auto")
		expect(syncDirection()).toBe("ltr")
	})

	it("notifies subscribers when the applied direction changes", () => {
		const onChange = vi.fn()
		const unsubscribe = subscribeToDirection(onChange)

		setStoredDirection("rtl")
		expect(onChange).toHaveBeenLastCalledWith("rtl")

		setStoredDirection("ltr")
		expect(onChange).toHaveBeenLastCalledWith("ltr")

		unsubscribe()
		setStoredDirection("rtl")
		expect(onChange).toHaveBeenCalledTimes(2)
	})
})
