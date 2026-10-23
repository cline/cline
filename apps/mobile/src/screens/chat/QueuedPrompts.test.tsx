/**
 * The queue strip is the feedback half of a promise the composer was already
 * making: "Agent is working… Send another message to queue it". The hub really
 * does queue it, so these tests pin that the queue is visible, removable, and
 * promotable — and that "send now" only appears when there is a turn to cut into.
 */

import { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { PendingPromptView } from "@/session";
import { render } from "../../ui/__testing__/render";
import { containsText } from "../__testing__/harness";
import { QueuedPrompts } from "./QueuedPrompts";

type Node = { props: Record<string, unknown> };

function prompt(overrides: Partial<PendingPromptView> = {}): PendingPromptView {
	return {
		id: "p1",
		prompt: "then run the tests",
		delivery: "queue",
		attachmentCount: 0,
		...overrides,
	};
}

function renderQueue(
	prompts: PendingPromptView[],
	options: { running?: boolean } = {},
) {
	const onRemove = vi.fn();
	const onSteer = vi.fn();
	const { root } = render(
		<QueuedPrompts
			prompts={prompts}
			running={options.running ?? false}
			onRemove={onRemove}
			onSteer={onSteer}
		/>,
	);
	const press = (label: string): void => {
		const [node] = root.findAll(
			(candidate: Node) => candidate.props.accessibilityLabel === label,
		);
		if (!node) {
			throw new Error(`no control labelled ${label}`);
		}
		(node.props.onPress as () => void)();
	};
	return { root, onRemove, onSteer, press };
}

describe("QueuedPrompts", () => {
	it("edits in place and awaits a save, preserving the draft on rejection", async () => {
		let reject!: (error: Error) => void;
		const onEdit = vi.fn(
			() =>
				new Promise<void>((_resolve, rejectPromise) => {
					reject = rejectPromise;
				}),
		);
		const { root } = render(
			<QueuedPrompts
				prompts={[prompt()]}
				running
				onRemove={vi.fn()}
				onSteer={vi.fn()}
				onEdit={onEdit}
			/>,
		);
		const control = (label: string) =>
			root
				.findAll(
					(node) =>
						typeof node.type === "string" &&
						node.props.accessibilityLabel === label,
				)
				.at(-1)!;
		act(() => control('Edit "then run the tests"').props.onPress());
		act(() =>
			control("Edit queued message").props.onChangeText("run just unit tests"),
		);
		await act(async () => {
			control("Save message").props.onPress();
		});
		expect(onEdit).toHaveBeenCalledWith("p1", "run just unit tests");
		expect(containsText(root, "Updating queued message…")).toBe(true);
		expect(control("Edit queued message").props.editable).toBe(false);
		await act(async () => reject(new Error("Network unavailable")));
		expect(control("Edit queued message").props.value).toBe(
			"run just unit tests",
		);
		expect(containsText(root, "Network unavailable")).toBe(true);
	});

	it("surfaces failed remove and steer actions without dropping the queued entry", async () => {
		for (const label of [
			'Remove "then run the tests" from the queue',
			'Send "then run the tests" now',
		]) {
			const failed = vi.fn(async () => {
				throw new Error("Connection closed");
			});
			const { root } = render(
				<QueuedPrompts
					prompts={[prompt()]}
					running
					onRemove={failed}
					onSteer={failed}
				/>,
			);
			await act(async () =>
				root
					.findAll(
						(node) =>
							typeof node.type === "string" &&
							node.props.accessibilityLabel === label,
					)
					.at(-1)!
					.props.onPress(),
			);
			expect(containsText(root, "Connection closed")).toBe(true);
			expect(containsText(root, "then run the tests")).toBe(true);
		}
	});
	it("renders nothing when the queue is empty", () => {
		const { root } = renderQueue([]);
		expect(
			root.findAll((node: Node) => node.props.testID === "queued-prompts"),
		).toHaveLength(0);
	});

	it("shows each queued prompt and how many there are", () => {
		const { root } = renderQueue([
			prompt({ id: "p1", prompt: "then run the tests" }),
			prompt({ id: "p2", prompt: "and open a PR" }),
		]);
		expect(containsText(root, "then run the tests")).toBe(true);
		expect(containsText(root, "and open a PR")).toBe(true);
		expect(containsText(root, "2 queued")).toBe(true);
	});

	it("counts a single entry in the singular", () => {
		const { root } = renderQueue([prompt()]);
		expect(containsText(root, "1 queued")).toBe(true);
	});

	it("removes the prompt it was asked to remove", () => {
		const { onRemove, press } = renderQueue([
			prompt({ id: "p1" }),
			prompt({ id: "p2", prompt: "and open a PR" }),
		]);
		press('Remove "and open a PR" from the queue');
		expect(onRemove).toHaveBeenCalledWith("p2");
	});

	it("offers send-now only while a turn is running", () => {
		const idle = renderQueue([prompt()], { running: false });
		expect(() => idle.press('Send "then run the tests" now')).toThrow();

		const live = renderQueue([prompt()], { running: true });
		live.press('Send "then run the tests" now');
		expect(live.onSteer).toHaveBeenCalledWith("p1");
	});

	it("does not offer to promote a prompt that is already steering", () => {
		const { press } = renderQueue([prompt({ delivery: "steer" })], {
			running: true,
		});
		expect(() => press('Send "then run the tests" now')).toThrow();
	});
});
