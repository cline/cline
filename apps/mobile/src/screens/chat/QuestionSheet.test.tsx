import { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { render } from "@/ui/__testing__/render";
import { containsText } from "../__testing__/harness";
import { QuestionSheet } from "./QuestionSheet";

const question = {
	requestId: "q1",
	question: "Which implementation?",
	options: ["Use Hub", "Use REST"],
};
function field(root: ReturnType<typeof render>["root"], label: string) {
	return root
		.findAll(
			(node) =>
				typeof node.type === "string" &&
				node.props.accessibilityLabel === label,
		)
		.at(-1)!;
}

describe("QuestionSheet", () => {
	it("answers on one tap and ignores duplicate taps before acknowledgement", async () => {
		let resolve!: () => void;
		const onAnswer = vi.fn(
			() =>
				new Promise<void>((done) => {
					resolve = done;
				}),
		);
		const { root } = render(
			<QuestionSheet questions={[question]} onAnswer={onAnswer} />,
		);
		act(() => {
			const press = field(root, "A. Use Hub").props.onPress;
			press();
			press();
		});
		expect(onAnswer).toHaveBeenCalledExactlyOnceWith("q1", "Use Hub");
		expect(field(root, "B. Use REST").props.disabled).toBe(true);
		await act(async () => resolve());
	});

	it("submits trimmed custom text and keeps it on failure for retry", async () => {
		const onAnswer = vi
			.fn()
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValue(undefined);
		const { root } = render(
			<QuestionSheet questions={[question]} onAnswer={onAnswer} />,
		);
		act(() =>
			field(root, "Custom answer").props.onChangeText(
				"  A different approach  ",
			),
		);
		await act(async () => field(root, "Submit").props.onPress());
		expect(onAnswer).toHaveBeenCalledWith("q1", "A different approach");
		expect(containsText(root, "Could not send your answer")).toBe(true);
		expect(field(root, "Custom answer").props.value).toBe(
			"  A different approach  ",
		);
		await act(async () => field(root, "Submit").props.onPress());
		expect(onAnswer).toHaveBeenCalledTimes(2);
	});

	it("does not submit blank custom text", async () => {
		const onAnswer = vi.fn();
		const { root } = render(
			<QuestionSheet questions={[question]} onAnswer={onAnswer} />,
		);
		act(() => field(root, "Custom answer").props.onChangeText("  "));
		await act(async () => field(root, "Submit").props.onPress());
		expect(onAnswer).not.toHaveBeenCalled();
	});
});
