import { describe, expect, it } from "vitest";
import { proposeNewBot } from "./index.js";

describe("propose_new_bot tool", () => {
	it("is inert - it just acknowledges the proposed name, never creates anything", async () => {
		const result = await proposeNewBot.execute(
			{ name: "Recipe Bot", initialProjectPath: "/Users/me/recipes" },
			{} as never,
		);
		expect(result).toEqual({ proposed: true, name: "Recipe Bot" });
	});

	it("requires a name in its input schema", () => {
		expect(proposeNewBot.inputSchema).toMatchObject({
			required: ["name"],
		});
	});
});
