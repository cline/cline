// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentAskQuestion } from "../components/index.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

describe("AgentAskQuestion", () => {
	it("reports the selected answer", async () => {
		const onAnswer = vi.fn();
		await act(async () =>
			root.render(
				<AgentAskQuestion
					items={[
						{
							description: "Request request-1 · Iteration 2",
							id: "request-1",
							meta: "Now",
							options: ["Continue", "Stop"],
							question: "Continue this task?",
						},
					]}
					onAnswer={onAnswer}
				/>,
			),
		);

		const buttons = container.querySelectorAll("button");
		await act(async () => buttons[1]?.click());

		const section = container.querySelector("section");
		const heading = container.querySelector("h2");
		expect(section?.getAttribute("aria-labelledby")).toBe(heading?.id);
		expect(heading?.textContent).toBe("Follow-up question");
		expect(onAnswer).toHaveBeenCalledWith("request-1", "Stop");
		expect(container.textContent).toContain("Request request-1 · Iteration 2");
	});

	it("shows controlled pending and error states", async () => {
		const item = {
			id: "request-1",
			options: ["Continue", "Stop"],
			question: "Continue this task?",
		};

		await act(async () =>
			root.render(
				<AgentAskQuestion
					errors={{ "request-1": "Could not send answer" }}
					items={[item]}
					onAnswer={vi.fn()}
					pendingAnswers={{ "request-1": "Continue" }}
				/>,
			),
		);

		const buttons = container.querySelectorAll("button");
		expect([...buttons].every((button) => button.disabled)).toBe(true);
		expect(buttons[0]?.textContent).toContain("Sending…");
		expect(container.textContent).toContain("Could not send answer");
		expect(container.querySelector('[role="alert"]')?.textContent).toBe(
			"Could not send answer",
		);
		expect(
			container
				.querySelector(".cline-ui-agent-ask-question__item")
				?.getAttribute("aria-busy"),
		).toBe("true");
	});

	it("deduplicates repeated model-supplied options", async () => {
		await act(async () =>
			root.render(
				<AgentAskQuestion
					items={[
						{
							id: "request-1",
							options: ["Yes", "Yes", "No"],
							question: "Proceed?",
						},
					]}
					onAnswer={vi.fn()}
				/>,
			),
		);

		const labels = [...container.querySelectorAll("button")].map(
			(button) => button.textContent,
		);
		expect(labels).toEqual(["Yes", "No"]);
	});
});
