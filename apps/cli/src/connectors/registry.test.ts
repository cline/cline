import { describe, expect, it } from "vitest";
import { getConnector, listConnectors } from "./registry";

describe("connector registry", () => {
	it("registers the Discord connector", async () => {
		expect(listConnectors().map((connector) => connector.name)).toContain(
			"discord",
		);

		await expect(getConnector("discord")).resolves.toMatchObject({
			name: "discord",
		});
	});
});
