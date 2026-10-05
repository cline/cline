import { afterEach, describe, expect, it } from "vitest";
import { createSapAiCoreProviderModule } from "./community";

// Kept in its own file so vitest gives it a fresh module context: this is the
// first time in the process that the SAP provider gets loaded, which is when
// its dependencies arm their process-wide handlers.
describe("community vendor module process hygiene", () => {
	// A host's own winston logger with `handleExceptions` installs a listener
	// with exactly this name; the SAP SDK's copies must be removed without it.
	const hostCatcher = function _uncaughtException() {}.bind({});
	const hostRejectionCatcher = function _unhandledRejection() {}.bind({});

	afterEach(() => {
		process.removeListener("uncaughtException", hostCatcher);
		process.removeListener("unhandledRejection", hostRejectionCatcher);
	});

	it("removes the SAP SDK's exit-on-uncaught-exception handlers but keeps the host's", async () => {
		process.on("uncaughtException", hostCatcher);
		process.on("unhandledRejection", hostRejectionCatcher);
		const before = {
			exceptions: process.listeners("uncaughtException"),
			rejections: process.listeners("unhandledRejection"),
		};

		await createSapAiCoreProviderModule({
			providerId: "sapaicore",
			baseUrl: "https://api.ai.example.aws.ml.hana.ondemand.com",
			options: {
				clientId: "sap-client",
				clientSecret: "sap-secret",
				tokenUrl: "https://auth.example/oauth/token",
				deploymentId: "deployment-id",
			},
		});

		// @sap-cloud-sdk/util registers winston's ExceptionHandler at load
		// (twice: once from the package and once from the private copy bundled
		// into @jerome-benoit/sap-ai-provider); winston exits the process 3s
		// after any uncaught exception. None of that may survive, while the
		// host's identically named listener must.
		expect(process.listeners("uncaughtException")).toEqual(before.exceptions);
		expect(process.listeners("unhandledRejection")).toEqual(before.rejections);
		expect(process.listeners("uncaughtException")).toContain(hostCatcher);
	});
});
