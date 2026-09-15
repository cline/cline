import { describe, expect, it } from "vitest";
// Import for its side effects only: the assertions below are about what
// loading this module does to the process, before any provider is built.
import "./community";

// Kept in its own file so vitest gives it a fresh module context: the
// createSapAiCoreProviderModule tests strip the handlers again as part of
// building a provider, which would mask a missing strip at module load.
describe("community vendor module process hygiene", () => {
	it("does not leave the SAP SDK's exit-on-uncaught-exception handler on the process", () => {
		// @sap-cloud-sdk/util registers winston's ExceptionHandler at load
		// (twice: once from the package and once from the private copy bundled
		// into @jerome-benoit/sap-ai-provider). winston binds it as
		// `_uncaughtException` and exits the process 3s after any uncaught
		// exception. Importing this module must leave none of them behind.
		const winstonHandlers = process
			.listeners("uncaughtException")
			.filter((listener) => listener.name === "bound _uncaughtException");
		expect(winstonHandlers).toEqual([]);
		const winstonRejectionHandlers = process
			.listeners("unhandledRejection")
			.filter((listener) => listener.name === "bound _unhandledRejection");
		expect(winstonRejectionHandlers).toEqual([]);
	});
});
