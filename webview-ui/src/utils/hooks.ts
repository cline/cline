import { useState, useEffect } from "react"

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
