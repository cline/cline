import type GorhomBottomSheet from "@gorhom/bottom-sheet";
import { createRef } from "react";
import { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clearAllSessionDrafts,
	questionAnswerDraftKey,
	readSessionDraft,
} from "@/state/session-drafts";
import { render } from "@/ui/__testing__/render";
import { containsText } from "../__testing__/harness";
import { QuestionSheet } from "./QuestionSheet";

afterEach(clearAllSessionDrafts);

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

describe("private question answer drafts", () => {
	it("retains a rejected answer across task navigation without leaking to another session or request", async () => {
		const onAnswer = vi.fn().mockRejectedValue(new Error("offline"));
		const first = render(
			<QuestionSheet
				draftKey="cloud:org-a:task-a"
				questions={[question]}
				onAnswer={onAnswer}
			/>,
		);
		act(() =>
			field(first.root, "Custom answer").props.onChangeText(
				"Exact unsent answer",
			),
		);
		await act(async () => field(first.root, "Submit").props.onPress());
		first.unmount();
		const other = render(
			<QuestionSheet
				draftKey="cloud:org-b:task-a"
				questions={[question]}
				onAnswer={onAnswer}
			/>,
		);
		expect(field(other.root, "Custom answer").props.value).toBe("");
		other.unmount();
		const returned = render(
			<QuestionSheet
				draftKey="cloud:org-a:task-a"
				questions={[question]}
				onAnswer={onAnswer}
			/>,
		);
		expect(field(returned.root, "Custom answer").props.value).toBe(
			"Exact unsent answer",
		);
		act(() =>
			returned.renderer.update(
				<QuestionSheet
					draftKey="cloud:org-a:task-a"
					questions={[{ ...question, requestId: "q2" }]}
					onAnswer={onAnswer}
				/>,
			),
		);
		expect(field(returned.root, "Custom answer").props.value).toBe("");
		expect(
			readSessionDraft(questionAnswerDraftKey("cloud:org-a:task-a", "q1")),
		).toBeUndefined();
	});
	it("waits for authoritative pending state then clears an answer resolved while offscreen", () => {
		const props = { draftKey: "cloud:task-a", onAnswer: vi.fn() };
		const first = render(<QuestionSheet {...props} questions={[question]} />);
		act(() => field(first.root, "Custom answer").props.onChangeText("Private"));
		first.unmount();
		const returned = render(
			<QuestionSheet {...props} draftsReady={false} questions={[]} />,
		);
		expect(readSessionDraft(questionAnswerDraftKey(props.draftKey, "q1"))).toBe(
			"Private",
		);
		act(() =>
			returned.renderer.update(
				<QuestionSheet {...props} draftsReady questions={[]} />,
			),
		);
		expect(
			readSessionDraft(questionAnswerDraftKey(props.draftKey, "q1")),
		).toBeUndefined();
		expect(returned.renderer.toJSON()).toBeNull();
	});
	it("clears successful answers and retires mounted private state on sign-out", async () => {
		const props = {
			draftKey: "cloud:task-a",
			onAnswer: vi.fn().mockResolvedValue(undefined),
			questions: [question],
		};
		const result = render(<QuestionSheet {...props} />);
		act(() =>
			field(result.root, "Custom answer").props.onChangeText("Private"),
		);
		await act(async () => field(result.root, "Submit").props.onPress());
		expect(
			readSessionDraft(questionAnswerDraftKey(props.draftKey, "q1")),
		).toBeUndefined();
		act(() =>
			field(result.root, "Custom answer").props.onChangeText(
				"Another private answer",
			),
		);
		const staleChange = field(result.root, "Custom answer").props.onChangeText;
		act(clearAllSessionDrafts);
		expect(field(result.root, "Custom answer").props.value).toBe("");
		act(() => staleChange("stale callback"));
		expect(
			readSessionDraft(questionAnswerDraftKey(props.draftKey, "q1")),
		).toBeUndefined();
	});
	it("unmounts the dynamic sheet once the last pending question is resolved", () => {
		const props = { onAnswer: vi.fn(), questions: [question] };
		const result = render(<QuestionSheet {...props} />);
		act(() =>
			result.renderer.update(<QuestionSheet {...props} questions={[]} />),
		);
		expect(result.renderer.toJSON()).toBeNull();
	});
});

it("opens on the first banner request after native dismissal while retaining the mounted answer", () => {
	const sheetRef = createRef<Pick<GorhomBottomSheet, "expand" | "close">>();
	const result = render(
		<QuestionSheet
			sheetRef={sheetRef}
			draftKey="cloud:manual-first-open"
			questions={[question]}
			onAnswer={vi.fn()}
		/>,
	);
	const sheet = () =>
		result.root
			.findAll(
				(node) => typeof node.type === "string" && node.type === "BottomSheet",
			)
			.at(-1);
	act(() =>
		field(result.root, "Custom answer").props.onChangeText("Keep exact answer"),
	);
	act(() => sheet()?.props.onChange(-1));
	expect(sheet()?.props.index).toBe(-1);
	act(() => sheetRef.current?.expand());
	expect(sheet()?.props.index).toBe(0);
	expect(field(result.root, "Custom answer").props.value).toBe(
		"Keep exact answer",
	);
});

it("auto-opens a newly arrived question after the screen previously had none", () => {
	const props = { draftKey: "cloud:arriving-question", onAnswer: vi.fn() };
	const result = render(<QuestionSheet {...props} questions={[]} />);
	expect(result.renderer.toJSON()).toBeNull();
	act(() =>
		result.renderer.update(<QuestionSheet {...props} questions={[question]} />),
	);
	const sheet = result.root
		.findAll(
			(node) => typeof node.type === "string" && node.type === "BottomSheet",
		)
		.at(-1);
	expect(sheet?.props.index).toBe(0);
	expect(field(result.root, "Custom answer").props.value).toBe("");
});
