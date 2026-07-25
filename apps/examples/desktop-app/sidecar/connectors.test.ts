import { describe, expect, it } from "vitest";
import { __test__ } from "./connectors";

describe("desktop connector lifecycle", () => {
	it("uses the atomic restart command for an active channel", () => {
		expect(
			__test__.buildConnectorLaunchArgs(["telegram", "-k", "token"], true),
		).toEqual(["--restart", "telegram", "-k", "token"]);
	});

	it("starts an inactive channel directly", () => {
		expect(
			__test__.buildConnectorLaunchArgs(["telegram", "-k", "token"], false),
		).toEqual(["telegram", "-k", "token"]);
	});
});
