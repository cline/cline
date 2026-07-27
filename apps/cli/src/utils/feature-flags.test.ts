import { afterEach, describe, expect, it } from "vitest";
import {
	disposeCliFeatureFlagsService,
	getCliFeatureFlagsService,
} from "./feature-flags";

describe("CLI feature flags singleton", () => {
	afterEach(async () => {
		await disposeCliFeatureFlagsService();
	});

	it("recreates the singleton after disposal", async () => {
		const service = getCliFeatureFlagsService();

		await disposeCliFeatureFlagsService();

		expect(getCliFeatureFlagsService()).not.toBe(service);
	});
});
