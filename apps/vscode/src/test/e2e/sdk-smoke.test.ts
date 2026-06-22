import { expect, type Frame } from "@playwright/test"
import { e2e } from "./utils/helpers"

// End-to-end tests for the SDK-rebuilt extension, exercising the real extension host in VS Code:
//   activate -> webview render -> gRPC -> Controller -> AuthService/ClineCore -> CoreSessionEvent
//   -> message translator -> ClineMessage -> webview render.
// In e2e the Cline backend is the mock server (CLINE_ENVIRONMENT=local), so sign-in and the LLM
// response are served by the mock without real credentials.

async function signIn(sidebar: Frame): Promise<void> {
	// When signed out, the welcome/onboarding view shows a sign-in CTA.
	const cta = sidebar.getByRole("button", { name: /get started|login to cline|sign in|try cline for free/i }).first()
	await expect(cta).toBeVisible({ timeout: 15_000 })
	await cta.click()
	// After the (mock) sign-in completes, welcomeViewCompleted flips true and the chat view renders.
	await expect(sidebar.getByTestId("chat-input")).toBeVisible({ timeout: 20_000 })
}

e2e("SDK shell renders the welcome view when signed out", async ({ sidebar }) => {
	// Signed out -> the onboarding/welcome view (not chat) is shown.
	await expect(sidebar.getByRole("button", { name: /get started for free/i })).toBeVisible({ timeout: 15_000 })
	await expect(sidebar.getByTestId("chat-input")).toHaveCount(0)
})

e2e("SDK shell: sign in, send a message, and stream a response through the SDK", async ({ sidebar }) => {
	await signIn(sidebar)

	const input = sidebar.getByTestId("chat-input")
	await input.click()
	await input.fill("Say hello in one word")
	await sidebar.getByTestId("send-button").click()

	// The send is accepted and dispatched to the host (input clears).
	await expect(input).toHaveValue("", { timeout: 15_000 })

	// The full loop completes: ClineCore -> cline provider -> mock /chat/completions streams the
	// response, which is translated to a ClineMessage and rendered in the transcript.
	await expect(sidebar.getByText(/mock Cline API response/i)).toBeVisible({ timeout: 30_000 })
})
