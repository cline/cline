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
		expect(
			[...buttons].every((button) => button.dataset.slot === "button"),
		).toBe(true);
		await act(async () => buttons[1]?.click());
		expect(onAnswer).not.toHaveBeenCalled();
		await act(async () => buttons[2]?.click());

		// The element carries no visible heading — the question itself leads —
		// but stays labelled for assistive tech.
		const section = container.querySelector("section");
		expect(section?.getAttribute("aria-label")).toBe("Follow-up question");
		expect(container.querySelector("h2")).toBeNull();
		expect(container.textContent).toContain("Continue this task?");
		expect(onAnswer).toHaveBeenCalledWith("request-1", "Stop");
		expect(container.textContent).toContain("Request request-1 · Iteration 2");
		const meta = container.querySelector<HTMLElement>(
			".cline-ui-agent-ask-question__meta",
		);
		expect(meta?.dataset.slot).toBe("badge");
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
		expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true");
		expect(buttons[2]?.textContent).toContain("Sending…");
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

	it("shows every controlled pending answer for a multiple-choice item", async () => {
		await act(async () =>
			root.render(
				<AgentAskQuestion
					items={[
						{
							id: "request-1",
							multiple: true,
							options: ["First", "Second", "Third"],
							question: "Choose",
						},
					]}
					onAnswer={() => {}}
					onAnswers={() => {}}
					pendingAnswers={{ "request-1": ["First", "Third"] }}
				/>,
			),
		);

		const buttons = container.querySelectorAll("button");
		expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true");
		expect(buttons[1]?.getAttribute("aria-pressed")).toBe("false");
		expect(buttons[2]?.getAttribute("aria-pressed")).toBe("true");
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
		expect(labels).toEqual(["AYes", "BNo", "Submit"]);
	});

	it("labels choices alphabetically without changing the submitted answer", async () => {
		const onAnswer = vi.fn();
		await act(async () =>
			root.render(
				<AgentAskQuestion
					items={[
						{
							id: "request-1",
							options: ["First", "Second"],
							question: "Choose",
						},
					]}
					onAnswer={onAnswer}
				/>,
			),
		);

		const buttons = container.querySelectorAll("button");
		expect(buttons[0]?.textContent).toBe("AFirst");
		expect(buttons[1]?.textContent).toBe("BSecond");
		expect(buttons[0]?.querySelector("[aria-hidden='true']")?.textContent).toBe(
			"A",
		);

		await act(async () => buttons[1]?.click());
		expect(onAnswer).not.toHaveBeenCalled();
		await act(async () => buttons[2]?.click());
		expect(onAnswer).toHaveBeenCalledWith("request-1", "Second");
	});

	it("does not advertise unsupported shortcuts after Z", async () => {
		const options = Array.from(
			{ length: 27 },
			(_, index) => `Option ${index + 1}`,
		);
		await act(async () =>
			root.render(
				<AgentAskQuestion
					items={[{ id: "request-1", options, question: "Choose" }]}
					onAnswer={() => {}}
				/>,
			),
		);

		const optionButtons = container.querySelectorAll<HTMLButtonElement>(
			".cline-ui-agent-ask-question__option",
		);
		expect(
			optionButtons[25]?.querySelector(
				".cline-ui-agent-ask-question__option-key",
			)?.textContent,
		).toBe("Z");
		expect(
			optionButtons[26]?.querySelector(
				".cline-ui-agent-ask-question__option-key",
			),
		).toBeNull();
	});

	it("submits all selected answers for a multiple-choice item", async () => {
		const onAnswer = vi.fn();
		const onAnswers = vi.fn();
		await act(async () =>
			root.render(
				<AgentAskQuestion
					items={[
						{
							id: "request-1",
							multiple: true,
							options: ["First", "Second", "Third"],
							question: "Choose",
						},
					]}
					onAnswer={onAnswer}
					onAnswers={onAnswers}
				/>,
			),
		);

		const buttons = container.querySelectorAll("button");
		expect(buttons[3]?.disabled).toBe(true);
		await act(async () => {
			buttons[0]?.click();
			buttons[2]?.click();
		});
		expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true");
		expect(buttons[2]?.getAttribute("aria-pressed")).toBe("true");
		expect(buttons[3]?.disabled).toBe(false);

		await act(async () => buttons[3]?.click());
		expect(onAnswer).not.toHaveBeenCalled();
		expect(onAnswers).toHaveBeenCalledWith("request-1", ["First", "Third"]);
		expect(container.textContent).toContain("Select all that apply.");
	});

	it("replaces a single choice and toggles a multiple choice off", async () => {
		const onAnswer = vi.fn();
		const onAnswers = vi.fn();
		await act(async () =>
			root.render(
				<AgentAskQuestion
					items={[
						{
							id: "single",
							options: ["First", "Second"],
							question: "Choose one",
						},
						{
							id: "multiple",
							multiple: true,
							options: ["Third", "Fourth"],
							question: "Choose any",
						},
					]}
					onAnswer={onAnswer}
					onAnswers={onAnswers}
				/>,
			),
		);

		const buttons = container.querySelectorAll("button");
		await act(async () => {
			buttons[0]?.click();
			buttons[1]?.click();
		});
		expect(buttons[0]?.getAttribute("aria-pressed")).toBe("false");
		expect(buttons[1]?.getAttribute("aria-pressed")).toBe("true");
		await act(async () => buttons[2]?.click());
		expect(onAnswer).toHaveBeenCalledWith("single", "Second");

		await act(async () => {
			buttons[3]?.click();
			buttons[3]?.click();
		});
		expect(buttons[3]?.getAttribute("aria-pressed")).toBe("false");
		expect(buttons[5]?.disabled).toBe(true);
	});

	it("does not submit a selection removed by an item update", async () => {
		const onAnswer = vi.fn();
		const renderItem = (options: readonly string[]) => (
			<AgentAskQuestion
				items={[{ id: "request-1", options, question: "Choose" }]}
				onAnswer={onAnswer}
			/>
		);

		await act(async () => root.render(renderItem(["First", "Second"])));
		await act(async () => container.querySelectorAll("button")[1]?.click());
		await act(async () => root.render(renderItem(["First", "Third"])));

		const buttons = container.querySelectorAll("button");
		expect(buttons[2]?.disabled).toBe(true);
		await act(async () => buttons[2]?.click());
		expect(onAnswer).not.toHaveBeenCalled();
	});

	it("focuses the first choice and supports letter and arrow-key selection", async () => {
		const onAnswer = vi.fn();
		await act(async () =>
			root.render(
				<AgentAskQuestion
					items={[
						{
							id: "request-1",
							options: ["First", "Second", "Third"],
							question: "Choose",
						},
					]}
					onAnswer={onAnswer}
				/>,
			),
		);

		const buttons = container.querySelectorAll("button");
		expect(document.activeElement).toBe(buttons[0]);

		await act(async () =>
			buttons[0]?.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
			),
		);
		expect(document.activeElement).toBe(buttons[1]);

		await act(async () =>
			buttons[1]?.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "c" }),
			),
		);
		expect(document.activeElement).toBe(buttons[2]);
		expect(buttons[2]?.getAttribute("aria-pressed")).toBe("true");

		expect(onAnswer).not.toHaveBeenCalled();
	});

	it("lets Enter activate the focused option instead of submitting another selection", async () => {
		const onAnswer = vi.fn();
		await act(async () =>
			root.render(
				<AgentAskQuestion
					items={[
						{
							id: "request-1",
							options: ["First", "Second"],
							question: "Choose",
						},
					]}
					onAnswer={onAnswer}
				/>,
			),
		);

		const buttons = container.querySelectorAll("button");
		await act(async () => buttons[0]?.click());
		await act(async () =>
			buttons[0]?.dispatchEvent(
				new KeyboardEvent("keydown", {
					bubbles: true,
					key: "ArrowDown",
				}),
			),
		);
		expect(document.activeElement).toBe(buttons[1]);

		const enter = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			key: "Enter",
		});
		await act(async () => {
			if (buttons[1]?.dispatchEvent(enter)) buttons[1].click();
		});

		expect(enter.defaultPrevented).toBe(false);
		expect(buttons[0]?.getAttribute("aria-pressed")).toBe("false");
		expect(buttons[1]?.getAttribute("aria-pressed")).toBe("true");

		await act(async () => buttons[2]?.click());
		expect(onAnswer).toHaveBeenCalledWith("request-1", "Second");
	});
});
