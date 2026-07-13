import { expect } from "@playwright/test"
import { applyInstalledPackCsp } from "../../../webview-ui/src/components/html_preview/installedPackCsp"
import { e2e } from "./utils/helpers"

e2e("installed Learning Pack child CSP blocks external resources and keeps inline bridge/data assets @phase1-csp", async ({
	app,
}) => {
	const isolatedWindow = app.waitForEvent("window")
	await app.evaluate(({ BrowserWindow }) => {
		const window = new BrowserWindow({ show: false })
		void window.loadURL("about:blank")
	})
	const isolated = await isolatedWindow
	let externalRequests = 0
	await isolated.route("https://phase1-csp.invalid/**", async (route) => {
		externalRequests++
		await route.fulfill({ status: 200, contentType: "application/javascript", body: "window.externalScriptRan=true" })
	})

	const secured = applyInstalledPackCsp(`<!doctype html><html><head>
		<meta http-equiv="Content-Security-Policy" content="default-src *">
		<script>window.inlineBridgeRan=true</script>
		<script src="https://phase1-csp.invalid/external.js"></script>
	</head><body>
		<img id="embedded" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">
		<img id="external" src="https://phase1-csp.invalid/external.png">
	</body></html>`)

	const result = await isolated.evaluate(async (srcdoc) => {
		const iframe = document.createElement("iframe")
		iframe.style.display = "none"
		document.body.appendChild(iframe)
		try {
			iframe.srcdoc = srcdoc
			await new Promise<void>((resolve) => iframe.addEventListener("load", () => resolve(), { once: true }))
			await new Promise((resolve) => setTimeout(resolve, 100))
			const child = iframe.contentWindow as (Window & { inlineBridgeRan?: boolean; externalScriptRan?: boolean }) | null
			const embedded = iframe.contentDocument?.getElementById("embedded") as HTMLImageElement | null
			const external = iframe.contentDocument?.getElementById("external") as HTMLImageElement | null
			return {
				inlineBridgeRan: child?.inlineBridgeRan === true,
				externalScriptRan: child?.externalScriptRan === true,
				embeddedWidth: embedded?.naturalWidth ?? 0,
				externalWidth: external?.naturalWidth ?? 0,
			}
		} finally {
			iframe.remove()
		}
	}, secured)

	expect(result.inlineBridgeRan).toBe(true)
	expect(result.externalScriptRan).toBe(false)
	expect(result.embeddedWidth).toBe(1)
	expect(result.externalWidth).toBe(0)
	expect(externalRequests).toBe(0)
	await isolated.close()
})
