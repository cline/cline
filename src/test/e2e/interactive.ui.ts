import { E2ETestConfigs, e2e } from "./utils/helpers"

e2e.extend<E2ETestConfigs>({
	grpcRecorderEnabled: true,
	grpcRecorderTestsFiltersEnabled: true,
})("Interactive Playwright launcher for the Cline VS Code extension", async ({ page }) => {
	console.log("VSCode with Cline extension is now running!")
	console.log("The Cline sidebar is automatically opened and ready for interaction.")
	console.log("gRPC recording is enabled - all calls will be recorded for inspection.")
	console.log("You can manually interact with the extension.")
	console.log("Close the VS Code window or press Ctrl+C to end the session.")

	// Keep the session running for manual interaction
	await page.pause()
})
