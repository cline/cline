import { describe, expect, it } from "vitest";
import { __test__ } from "./common";

describe("spawnDetachedConnector", () => {
	it("preserves the connect subcommand when building detached connector args", () => {
		expect(
			__test__.buildDetachedConnectorArgs(
				["connect", "telegram"],
				["-m", "ClineAdapterBot", "-k", "token-123"],
			),
		).toEqual([
			"connect",
			"telegram",
			"-m",
			"ClineAdapterBot",
			"-k",
			"token-123",
			"-i",
		]);
	});
});
