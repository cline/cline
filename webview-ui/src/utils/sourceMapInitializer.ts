/**
 * Source Map Initializer
 *
 * This utility ensures source maps are properly loaded in production builds.
 * It attempts to preload source maps for all scripts on the page and
 * sets up global error handlers to enhance errors with source maps.
 *
 * This implementation is compatible with VSCode's Content Security Policy.
 */

import { enhanceErrorWithSourceMaps } from "./sourceMapUtils"

/**
 * Initialize source map support for production builds
 */
export function initializeSourceMaps(): void {
	if (process.env.NODE_ENV !== "production") {
		// Only needed in production builds
		return
	}

	console.debug("Initializing CSP-compatible source map support for production build")

	// Set up global error handler
	window.addEventListener("error", async (event) => {
		if (event.error && event.error instanceof Error) {
			try {
				// Apply source maps to the error
				const enhancedError = await enhanceErrorWithSourceMaps(event.error)

				// Log the enhanced error
				console.error("Source mapped error:", enhancedError)

				// Don't prevent default handling - let the ErrorBoundary catch it
			} catch (e) {
				console.error("Error enhancing error with source maps:", e)
			}
		}
	})

	// Set up unhandled promise rejection handler
	window.addEventListener("unhandledrejection", async (event) => {
		if (event.reason && event.reason instanceof Error) {
			try {
				// Apply source maps to the error
				const enhancedError = await enhanceErrorWithSourceMaps(event.reason)

				// Log the enhanced error
				console.error("Source mapped rejection:", enhancedError)
			} catch (e) {
				console.error("Error enhancing rejection with source maps:", e)
			}
		}
	})

	// Preload source maps for all scripts
	try {
		const scripts = document.getElementsByTagName("script")
		for (let i = 0; i < scripts.length; i++) {
			const script = scripts[i]
			if (script.src) {
				// Try multiple source map locations
				const possibleMapUrls = [
					`${script.src}.map`,
					`${script.src}?source-map=true`,
					script.src.replace(/\.js$/, ".js.map"),
					script.src.replace(/\.js$/, ".map.json"),
					script.src.replace(/\.js$/, ".sourcemap"),
				]

				// Preload all possible source map locations
				for (const mapUrl of possibleMapUrls) {
					const link = document.createElement("link")
					link.rel = "preload"
					link.as = "fetch"
					link.href = mapUrl
					link.crossOrigin = "anonymous"
					document.head.appendChild(link)
				}

				// Also check for inline sourceMappingURL comments
				fetch(script.src)
					.then((response) => response.text())
					.then((content) => {
						const sourceMappingURLMatch = content.match(/\/\/[#@]\s*sourceMappingURL=([^\s]+)/)
						if (sourceMappingURLMatch && sourceMappingURLMatch[1]) {
							const sourceMappingURL = sourceMappingURLMatch[1]

							// If it's not a data: URL, preload it
							if (!sourceMappingURL.startsWith("data:")) {
								const scriptUrlObj = new URL(script.src)
								const baseUrl = scriptUrlObj.href.substring(0, scriptUrlObj.href.lastIndexOf("/") + 1)
								const fullUrl = new URL(sourceMappingURL, baseUrl).href

								const link = document.createElement("link")
								link.rel = "preload"
								link.as = "fetch"
								link.href = fullUrl
								link.crossOrigin = "anonymous"
								document.head.appendChild(link)
							}
						}
					})
					.catch((e) => console.debug("Error checking for inline sourceMappingURL:", e))
			}
		}
	} catch (e) {
		console.error("Error preloading source maps:", e)
	}
}

/**
 * Expose source maps on the window object for debugging
 */
export function exposeSourceMapsForDebugging(): void {
	if (process.env.NODE_ENV !== "production") {
		return
	}

	try {
		// Add a global function to manually apply source maps to an error
		;(window as any).__applySourceMaps = async (error: Error) => {
			if (!(error instanceof Error)) {
				console.error("Not an Error object:", error)
				return error
			}
			return await enhanceErrorWithSourceMaps(error)
		}

		// Add a global function to test source map functionality
		;(window as any).__testSourceMaps = () => {
			try {
				// Intentionally cause an error
				const obj: any = undefined
				obj.nonExistentMethod()
			} catch (e) {
				if (e instanceof Error) {
					console.log("Original error:", e)
					;(window as any).__applySourceMaps(e).then((enhanced: Error) => {
						console.log("Enhanced error:", enhanced)

						// Log the source mapped stack if available
						if ("sourceMappedStack" in enhanced) {
							console.log("Source mapped stack:", enhanced.sourceMappedStack)
						}

						// Log the source mapped component stack if available
						if ("sourceMappedComponentStack" in enhanced) {
							console.log("Source mapped component stack:", enhanced.sourceMappedComponentStack)
						}
					})
				}
			}
		}

		// Add a global function to check if source maps are available for a script
		;(window as any).__checkSourceMap = async (scriptUrl: string) => {
			try {
				const response = await fetch(`${scriptUrl}.map`)
				if (response.ok) {
					const sourceMap = await response.json()
					const originalFileName =
						sourceMap.sources && sourceMap.sources.length > 0 ? sourceMap.sources[0] : "unknown"
					console.log(`Source map found for ${scriptUrl}. Original file: ${originalFileName}`)
					return true
				} else {
					console.log(`No source map found for ${scriptUrl}`)
					return false
				}
			} catch (e) {
				console.error(`Error checking source map for ${scriptUrl}:`, e)
				return false
			}
		}

		console.debug("Source map debugging utilities exposed on window object")
	} catch (e) {
		console.error("Error exposing source maps for debugging:", e)
	}
}
