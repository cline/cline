// Bridge script to make the webview work in Electron
;(function () {
	// Function to apply theme CSS variables to the DOM
	function applyThemeVariables(theme) {
		if (!theme || !theme.colors) {
			return
		}

		const root = document.documentElement
		const themeStyleElement = document.getElementById("vscode-theme-styles")

		// Build CSS variables string
		let cssVars = ":root {\n"
		Object.entries(theme.colors).forEach(([key, value]) => {
			const cssVarName = `--vscode-${key.replace(/\./g, "-")}`
			root.style.setProperty(cssVarName, value)
			cssVars += `  ${cssVarName}: ${value};\n`
		})
		cssVars += "}\n"

		// Inject into style element
		if (themeStyleElement) {
			themeStyleElement.textContent = cssVars
			console.log("Injected CSS variables into style element:", cssVars)
		} else {
			console.error("vscode-theme-styles element not found!")
		}

		// Immediate body styling with null checks
		if (document.body) {
			document.body.style.backgroundColor = theme.colors["editor.background"] || "#1E1E1E"
			document.body.style.color = theme.colors["editor.foreground"] || "#D4D4D4"
		}
		if (root) {
			root.style.backgroundColor = theme.colors["editor.background"] || "#1E1E1E"
			root.style.color = theme.colors["editor.foreground"] || "#D4D4D4"
		}

		// Log specific icon foreground value for debugging
		// const iconForegroundValue = getComputedStyle(root).getPropertyValue('--vscode-icon-foreground');
		// console.log('--vscode-icon-foreground value:', iconForegroundValue);

		// console.log('Applied theme variables to DOM');
	}

	// Listen for theme updates from gRPC responses
	function handleThemeUpdate(event) {
		if (event.data && event.data.type === "grpc_response") {
			const response = event.data.grpc_response
			if (response && response.message && response.message.value) {
				try {
					const theme = JSON.parse(response.message.value)
					if (theme.colors) {
						applyThemeVariables(theme)
					}
				} catch (e) {
					console.error("Error parsing theme:", e)
				}
			}
		}
	}

	// Wait for the preload script to be loaded
	function waitForAcquireVsCodeApi() {
		if (window.acquireVsCodeApi) {
			return
		}

		// Mock VSCode API for webview compatibility
		window.acquireVsCodeApi = function () {
			return {
				postMessage: function (message) {
					// console.log('VSCode API postMessage:', message); // Disabled to reduce console noise
					if (window.electronAPI) {
						window.electronAPI.postMessage(message)
					}
				},
				getState: function () {
					const state = localStorage.getItem("vscodeState")
					return state ? JSON.parse(state) : undefined
				},
				setState: function (newState) {
					localStorage.setItem("vscodeState", JSON.stringify(newState))
					return newState
				},
			}
		}
	}

	// Set up global flags
	window.__is_standalone__ = true
	window.WEBVIEW_PROVIDER_TYPE = "sidebar"
	window.clineClientId = "electron-client-" + Date.now()

	// Apply default dark theme immediately
	applyThemeVariables({
		colors: {
			"editor.background": "#1E1E1E",
			"editor.foreground": "#D4D4D4",
			"activityBar.background": "#2D2D30",
			"activityBar.foreground": "#FFFFFF",
			"sideBar.background": "#252526",
			"sideBar.foreground": "#CCCCCC",
			"statusBar.background": "#007ACC",
			"statusBar.foreground": "#FFFFFF",
			"input.background": "#3C3C3C",
			"input.foreground": "#CCCCCC",
			"button.background": "#0E639C",
			"button.foreground": "#FFFFFF",
			"dropdown.background": "#3C3C3C",
			"dropdown.foreground": "#CCCCCC",
			"list.hoverBackground": "#2A2D2E",
			"list.activeSelectionBackground": "#094771",
			"list.activeSelectionForeground": "#FFFFFF",
			"panel.background": "#1E1E1E",
			"panel.border": "#2D2D30",
			"textLink.foreground": "#3794ff",
			"textLink.activeForeground": "#3794ff",
			descriptionForeground: "#CCCCCC",
			errorForeground: "#f14c4c",
			focusBorder: "#007fd4",
			"selection.background": "#094771",
			"widget.shadow": "#0000005c",
			"badge.background": "#4d4d4d",
			"badge.foreground": "#ffffff",
			"progressBar.background": "#0e70c0",
			"breadcrumb.foreground": "#cccccccc",
			"breadcrumb.background": "#1E1E1E",
			"scrollbar.shadow": "#000000",
			"scrollbarSlider.background": "#797979",
			"scrollbarSlider.hoverBackground": "#646464",
			"scrollbarSlider.activeBackground": "#bfbfbf",
			"icon.foreground": "#cccccc",
			"toolbar.hoverBackground": "#5a5d5e50",
			"dropdown.border": "#3c3c3c",
			"checkbox.background": "#3c3c3c",
			"checkbox.foreground": "#f0f0f0",
			"checkbox.border": "#3c3c3c",
			"tree.indentGuidesStroke": "#585858",
			"list.inactiveSelectionBackground": "#37373d",
			"list.inactiveSelectionForeground": "#cccccc",
			"list.focusBackground": "#062f4a",
			"list.focusForeground": "#cccccc",
		},
	})

	// Listen for theme updates
	window.addEventListener("message", handleThemeUpdate)

	// Initialize when DOM is ready
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", waitForAcquireVsCodeApi)
	} else {
		waitForAcquireVsCodeApi()
	}

	// Initialize VSCode Webview Components
	if (window.customElements) {
		// console.log('Custom elements available, VSCode components should work'); // Disabled to reduce console noise
	} else {
		console.warn("Custom elements not available, VSCode components may not work")
	}

	// Add more debugging - disabled to reduce console noise
	const observer = new MutationObserver(() => {
		const vscodeElements = document.querySelectorAll('[class*="vscode-"], vscode-button, vscode-textfield, vscode-dropdown')
		if (vscodeElements.length > 0) {
			// console.log('VSCode elements found:', vscodeElements.length); // Disabled to reduce console noise
		}
	})

	if (document.body) {
		observer.observe(document.body, {
			childList: true,
			subtree: true,
		})
	} else {
		// Wait for body to be available
		document.addEventListener("DOMContentLoaded", () => {
			if (document.body) {
				observer.observe(document.body, {
					childList: true,
					subtree: true,
				})
			}
		})
	}

	// console.log('Webview bridge initialized with enhanced debugging'); // Disabled to reduce console noise
})()
