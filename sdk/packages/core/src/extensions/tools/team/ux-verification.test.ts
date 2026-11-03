import { describe, expect, it, vi } from "vitest";
import { createUxVerifierTool } from "./ux-verification";

const context = { agentId: "lead", iteration: 1 };
const check = {
	id: "dialog",
	steps: ["Click Open"],
	expected: "Dialog is visible",
};

describe("UX verifier delegation", () => {
	it.each([
		{ task: "", checklist: [check] },
		{ task: "Inspect the app", checklist: [] },
		{ task: "Inspect the app", checklist: [check, check] },
		{ task: "Inspect the app", checklist: [{ ...check, steps: [] }] },
	])("rejects invalid checklists before starting a worker", async (input) => {
		const execute = vi.fn();
		expect(
			await createUxVerifierTool({ execute }).execute(input, context),
		).toHaveProperty("error");
		expect(execute).not.toHaveBeenCalled();
	});

	it("does not delegate an already cancelled request", async () => {
		const execute = vi.fn();
		const controller = new AbortController();
		controller.abort();
		await expect(
			createUxVerifierTool({ execute }).execute(
				{ task: "Inspect the app", checklist: [check] },
				{ ...context, signal: controller.signal },
			),
		).rejects.toThrow();
		expect(execute).not.toHaveBeenCalled();
	});
});
