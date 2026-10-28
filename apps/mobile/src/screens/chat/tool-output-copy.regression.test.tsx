import * as Clipboard from "expo-clipboard";
import { act } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../../ui/__testing__/render";
import { AssistantMessage } from "./blocks";
import { ReasoningStateProvider } from "./reasoning-state";

beforeEach(() => vi.clearAllMocks());

describe("tool-only diagnostics are usable outside the transcript", () => {
	const output =
		"Build failed\nSee https://example.com/build/123\nError: missing config";
	function expandedTool() {
		const rendered = render(
			<ReasoningStateProvider>
				<AssistantMessage
					message={{
						id: "tool-only",
						role: "assistant",
						origin: "hydrated",
						blocks: [
							{
								kind: "tool",
								toolCallId: "build",
								name: "run_command",
								state: "completed",
								input: { command: "bun run build" },
								output,
							},
						],
					}}
				/>
			</ReasoningStateProvider>,
		);
		const trigger = rendered.root
			.findAll(
				(node) =>
					typeof node.type === "string" &&
					typeof node.props.accessibilityLabel === "string" &&
					node.props.accessibilityLabel.startsWith("Tool "),
			)
			.at(-1);
		if (!trigger) throw new Error("Tool disclosure must be reachable");
		act(() => trigger.props.onPress());
		return rendered;
	}
	it("allows native selection of the command and complete output", () => {
		const { root } = expandedTool();
		const text = root
			.findAll(
				(node) =>
					typeof node.type === "string" &&
					node.props.children === `$ bun run build\n${output}`,
			)
			.at(-1);
		expect(text).toBeDefined();
		expect(text?.props.selectable).toBe(true);
	});
	it("copies the complete command and diagnostic without assistant narration", async () => {
		const { root } = expandedTool();
		const copy = root
			.findAll(
				(node) =>
					typeof node.type === "string" &&
					node.props.accessibilityLabel === "Copy tool output",
			)
			.at(-1);
		expect(
			copy,
			"A tool-only response needs its own copy action",
		).toBeDefined();
		await act(async () => copy!.props.onPress());
		expect(Clipboard.setStringAsync).toHaveBeenCalledWith(
			`$ bun run build\n${output}`,
		);
	});
});
