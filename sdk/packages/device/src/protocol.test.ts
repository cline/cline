import { describe, expect, it } from "bun:test";
import { parseDeviceMessage } from "./protocol";

describe("parseDeviceMessage", () => {
	it("validates typed prompt size, content, IDs, and routing", () => {
		const prompt = {
			t: "prompt",
			id: "1",
			text: 'print "hello" \\ path',
			target: "new",
		};
		expect(parseDeviceMessage(JSON.stringify(prompt))).toEqual(prompt);
		expect(
			parseDeviceMessage(JSON.stringify({ ...prompt, text: "x".repeat(384) })),
		).toBeDefined();
		expect(
			parseDeviceMessage(JSON.stringify({ ...prompt, text: "界".repeat(384) })),
		).toBeUndefined();
		for (const bad of [
			{ text: "x".repeat(385) },
			{ text: " " },
			{ text: "x\n" },
			{ text: 4 },
			{ id: "" },
			{ id: "x".repeat(33) },
			{ target: "bad" },
		])
			expect(
				parseDeviceMessage(JSON.stringify({ ...prompt, ...bad })),
			).toBeUndefined();
	});
	it("accepts valid commands and rejects junk", () => {
		expect(parseDeviceMessage('{"t":"approve","id":"a1"}')).toEqual({
			t: "approve",
			id: "a1",
		});
		expect(parseDeviceMessage('{"t":"approve"}')).toBeUndefined();
		expect(parseDeviceMessage('{"t":"nope"}')).toBeUndefined();
		expect(parseDeviceMessage("not json")).toBeUndefined();
		expect(
			parseDeviceMessage(`{"t":"abort","x":"${"a".repeat(2000)}"}`),
		).toBeUndefined();
	});
});
