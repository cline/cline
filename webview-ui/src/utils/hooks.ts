import { useCallback, useRef, useLayoutEffect, useState, useEffect } from "react"

interface NavigatorUAData {
	platform: string
	brands: { brand: string; version: string }[]
}

const navigatorErrorMessage =
	"Could not find `userAgent` or `userAgentData` window.navigator properties to set `os`, `browser` and `version`"
const removeExcessMozillaAndVersion = /^mozilla\/\d\.\d\W/
const browserPattern = /(\w+)\/(\d+\.\d+(?:\.\d+)?(?:\.\d+)?)/g
const engineAndVersionPattern = /^(ver|cri|gec)/
const brandList = ["chrome", "opera", "safari", "edge", "firefox"]
const unknown = "Unknown"
const empty = ""
const { isArray } = Array

const desktops = {
	windows: /win/,
	mac: /macintosh/,
	linux: /linux/,
}

const detectPlatform = (customUserAgent?: string, customUserAgentData?: NavigatorUAData) => {
	let userAgent = customUserAgent || window.navigator.userAgent
	let userAgentData = customUserAgentData || (window.navigator as any).userAgentData

	if (userAgent) {
		const ua = userAgent.toLowerCase().replace(removeExcessMozillaAndVersion, empty)

		// Determine the operating system.
		const desktopOS = (Object.keys(desktops) as (keyof typeof desktops)[]).find((os) => desktops[os].test(ua))
		const os = desktopOS || unknown

		// Extract browser and version information.
		const browserTest = ua.match(browserPattern)
		const versionRegex = /version\/(\d+(\.\d+)*)/
		const safariVersion = ua.match(versionRegex)
		const saVersion = isArray(safariVersion) ? safariVersion[1] : null
		const browserOffset = browserTest && (browserTest.length > 2 && !engineAndVersionPattern.test(browserTest[1]) ? 1 : 0)
		const browserResult = browserTest && browserTest[browserTest.length - 1 - (browserOffset || 0)].split("/")
		const browser = (browserResult && browserResult[0]) || unknown
		const version = saVersion ? saVersion : (browserResult && browserResult[1]) || unknown

		return { os, browser, version }
	} else if (userAgentData) {
		const os = userAgentData.platform.toLowerCase()
		let platformData

		// Extract platform brand and version information.
		for (const agentBrand of userAgentData.brands) {
			const agentBrandEntry = agentBrand.brand.toLowerCase()
			const foundBrand = brandList.find((brand) => agentBrandEntry.includes(brand))
			if (foundBrand) {
				platformData = { browser: foundBrand, version: agentBrand.version }
				break
			}
		}
		const brandVersionData = platformData || { browser: unknown, version: unknown }
		return { os, ...brandVersionData }
	} else {
		console.error(navigatorErrorMessage)
		return {
			os: navigator.platform || unknown,
			browser: unknown,
			version: unknown,
		}
	}
}

const detectMetaKeyChar = (platform: string) => {
	if (platform === "mac") {
		return "⌘ Command"
	} else if (platform === "windows") {
		return "⊞ Win"
	} else {
		return "Alt"
	}
}

const usePlatformDetection = (customUserAgent?: string, customUserAgentData?: NavigatorUAData) => {
	const [platform, setPlatform] = useState<{ os: string; browser: string; version: string }>({
		os: unknown,
		browser: unknown,
		version: unknown,
	})

	const [metaKeyChar, setMetaKeyChar] = useState(unknown)

	useEffect(() => {
		const detectedPlatform = detectPlatform(customUserAgent, customUserAgentData)
		setPlatform(detectedPlatform)
		const detectedMetaKeyChar = detectMetaKeyChar(detectedPlatform.os)
		setMetaKeyChar(detectedMetaKeyChar)
	}, [customUserAgent, customUserAgentData])

	return [platform, metaKeyChar]
}

export { usePlatformDetection }

export const useShortcut = (shortcut: string, callback: any, options = { disableTextInputs: true }) => {
	const callbackRef = useRef(callback)
	const [keyCombo, setKeyCombo] = useState<string[]>([])

	useLayoutEffect(() => {
		callbackRef.current = callback
	})

	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			const isTextInput =
				event.target instanceof HTMLTextAreaElement ||
				(event.target instanceof HTMLInputElement && (!event.target.type || event.target.type === "text")) ||
				(event.target as HTMLElement).isContentEditable

			const modifierMap: { [key: string]: boolean } = {
				Control: event.ctrlKey,
				Alt: event.altKey,
				Meta: event.metaKey, // alias for Command
				Shift: event.shiftKey,
			}

			if (event.repeat) {
				return null
			}

			if (options.disableTextInputs && isTextInput) {
				return event.stopPropagation()
			}

			if (shortcut.includes("+")) {
				const keyArray = shortcut.split("+")

				if (Object.keys(modifierMap).includes(keyArray[0])) {
					const finalKey = keyArray.pop()

					if (keyArray.every((k) => modifierMap[k]) && finalKey === event.key) {
						return callbackRef.current(event)
					}
				} else {
					if (keyArray[keyCombo.length] === event.key) {
						if (keyArray[keyArray.length - 1] === event.key && keyCombo.length === keyArray.length - 1) {
							callbackRef.current(event)
							return setKeyCombo([])
						}

						return setKeyCombo((prevCombo) => [...prevCombo, event.key])
					}
					if (keyCombo.length > 0) {
						return setKeyCombo([])
					}
				}
			}

			if (shortcut === event.key) {
				return callbackRef.current(event)
			}
		},
		[keyCombo.length, options.disableTextInputs, shortcut],
	)

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown)

		return () => {
			window.removeEventListener("keydown", handleKeyDown)
		}
	}, [handleKeyDown])
}
