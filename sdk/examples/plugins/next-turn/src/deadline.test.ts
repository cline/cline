import { describe, expect, test } from "bun:test";
import { TIMED_OUT, withDeadline } from "./deadline";

describe("a deadline", () => {
	test("starts its budget when the work says it has sent, not when it was queued", async () => {
		let arm: () => void = () => {};
		const armed = new Promise<void>((resolve) => {
			arm = resolve;
		});
		const answer = await withDeadline(
			async () => {
				await new Promise((resolve) => setTimeout(resolve, 40));
				arm();
				await new Promise((resolve) => setTimeout(resolve, 40));
				return "answered";
			},
			50,
			armed,
		);
		expect(answer).toBe("answered");
	});

	test("still caps work that never reaches the provider", async () => {
		const neverArms = new Promise<void>(() => {});
		const answer = await withDeadline(
			() => new Promise((resolve) => setTimeout(resolve, 60)),
			10,
			neverArms,
		);
		expect(answer).toBe(TIMED_OUT);
	});
});