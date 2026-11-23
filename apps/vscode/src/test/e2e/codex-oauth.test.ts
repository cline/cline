import net from "node:net"
import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

async function waitForPortListening(port: number, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		for (const host of ["127.0.0.1", "::1"]) {
			const connected = await new Promise<boolean>((resolve) => {
				const socket = net.connect({ port, host }, () => {
					socket.destroy()
					resolve(true)
				})
				socket.once("error", () => resolve(false))
			})
			if (connected) return
		}
		await new Promise((r) => setTimeout(r, 200))
	}
	throw new Error(`Nothing listening on port ${port} after ${timeoutMs}ms`)
}

async function navigateToCodexProvider(sidebar: import("@playwright/test").Frame): Promise<void> {
	await sidebar.getByText("Bring my own API key").click()
	await sidebar.getByRole("button", { name: "Continue" }).click()
	const providerSelectorInput = sidebar.getByTestId("provider-selector-input")
	await providerSelectorInput.click({ delay: 100 })
	await providerSelectorInput.pressSequentially("chatgpt", { delay: 50 })
	await sidebar.getByTestId("provider-option-openai-codex").click({ delay: 100 })
}

async function occupy(host: string, port: number): Promise<net.Server> {
	const srv = net.createServer()
	await new Promise<void>((resolve, reject) => {
		srv.once("error", reject)
		srv.listen(port, host, () => resolve())
	})
	return srv
}

e2e("Codex sign-in fails fast with a port-in-use toast when 1455 is occupied", async ({ page, sidebar }) => {
	// Occupy the fixed Codex OAuth callback port on both loopback families so
	// the extension host cannot bind it regardless of how it resolves localhost.
	const blockers: net.Server[] = []
	for (const host of ["127.0.0.1", "::1"]) {
		try {
			blockers.push(await occupy(host, 1455))
		} catch {}
	}
	expect(blockers.length).toBeGreaterThan(0)

	try {
		await navigateToCodexProvider(sidebar)

		const signInButton = sidebar.getByRole("button", { name: "Sign in to OpenAI Codex" })
		await expect(signInButton).toBeVisible()
		await signInButton.click()

		// The fix: an immediate, actionable error toast in the workbench
		// (notifications live in the main window DOM, not the webview frame).
		await expect(page.locator(".notifications-toasts").getByText(/Port 1455 is already in use/)).toBeVisible({
			timeout: 15_000,
		})
	} finally {
		await Promise.all(blockers.map((b) => new Promise<void>((resolve) => b.close(() => resolve()))))
	}
})

e2e("Codex sign-in with port free binds the callback server and surfaces OAuth redirect errors", async ({ page, sidebar }) => {
	await navigateToCodexProvider(sidebar)

	const signInButton = sidebar.getByRole("button", { name: "Sign in to OpenAI Codex" })
	await expect(signInButton).toBeVisible()
	await signInButton.click()

	// The SDK binds the callback server before opening the browser; prove the
	// real port-free wiring by simulating the OAuth redirect the browser
	// would deliver. An `error` callback settles regardless of state.
	await waitForPortListening(1455, 15_000)
	const response = await fetch("http://localhost:1455/auth/callback?error=access_denied")
	expect(response.status).toBe(400)

	await expect(page.locator(".notifications-toasts").getByText(/OAuth error: access_denied/)).toBeVisible({
		timeout: 15_000,
	})
})
