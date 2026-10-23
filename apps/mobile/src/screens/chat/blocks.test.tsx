import { act, type ReactTestInstance } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import type { SessionMessageView } from "@/session";
import { hasStyle, render } from "../../ui/__testing__/render";
import { allText, containsText } from "../__testing__/harness";
import { AssistantMessage, UserMessageBubble } from "./blocks";
import { ReasoningStateProvider } from "./reasoning-state";

/** The innermost host node whose `accessibilityLabel` starts with `prefix`. */
function findByLabelPrefix(
	root: ReactTestInstance,
	prefix: string,
): ReactTestInstance | undefined {
	return root
		.findAll(
			(node) =>
				typeof node.type === "string" &&
				typeof node.props.accessibilityLabel === "string" &&
				node.props.accessibilityLabel.startsWith(prefix),
		)
		.at(-1);
}

function userMessage(text: string): SessionMessageView {
	return {
		id: "u1",
		role: "user",
		origin: "hydrated",
		blocks: [{ kind: "text", text }],
	};
}

function reasoningMessage(
	text: string,
	{ id = "a1", redacted = false } = {},
): SessionMessageView {
	return {
		id,
		role: "assistant",
		origin: "live",
		blocks: [{ kind: "reasoning", text, redacted }],
	};
}

describe("UserMessageBubble", () => {
	it("renders the human text, not the runtime's user_input envelope", () => {
		const { root } = render(
			<UserMessageBubble
				message={userMessage(
					'<user_input mode="act">Run a command that sleeps for 30 seconds, then report completion.</user_input>',
				)}
			/>,
		);
		expect(
			containsText(
				root,
				"Run a command that sleeps for 30 seconds, then report completion.",
			),
		).toBe(true);
		expect(allText(root)).not.toContain("<user_input");
		expect(allText(root)).not.toContain("</user_input>");
	});

	it("promotes the wrapper's mode to a chip instead of discarding it", () => {
		const { root } = render(
			<UserMessageBubble
				message={userMessage(
					'<user_input mode="plan">explore the repo</user_input>',
				)}
			/>,
		);
		expect(containsText(root, "Plan")).toBe(true);
		expect(findByLabelPrefix(root, "Sent in plan mode")).toBeDefined();
	});

	it("shows no mode chip when the message carries no wrapper", () => {
		const { root } = render(
			<UserMessageBubble message={userMessage("hello")} />,
		);
		expect(containsText(root, "hello")).toBe(true);
		expect(findByLabelPrefix(root, "Sent in")).toBeUndefined();
	});

	it("uses Cline's bordered user-message surface", () => {
		const { root } = render(
			<UserMessageBubble message={userMessage("hello")} />,
		);
		expect(hasStyle(root, "borderWidth", 1)).toBe(true);
		expect(hasStyle(root, "borderRadius", 8)).toBe(true);
	});

	it("leaves prose that talks about <user_input> visible", () => {
		const raw = "why does the bubble show <user_input> to me?";
		const { root } = render(<UserMessageBubble message={userMessage(raw)} />);
		expect(containsText(root, raw)).toBe(true);
		expect(findByLabelPrefix(root, "Sent in")).toBeUndefined();
	});

	it("does not unwrap a partial wrapper", () => {
		const raw = '<user_input mode="act">missing the close tag';
		const { root } = render(<UserMessageBubble message={userMessage(raw)} />);
		expect(containsText(root, raw)).toBe(true);
	});

	it("renders images attached to a user turn", () => {
		const message = userMessage("look at this");
		message.blocks.push({
			kind: "media",
			media: {
				id: "image-1",
				modality: "image",
				mediaType: "image/png",
				source: {
					type: "base64",
					data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
				},
			},
		});
		const { root } = render(<UserMessageBubble message={message} />);
		expect(
			root.findAll(
				(node) => node.props.accessibilityLabel === "Generated image",
			),
		).not.toHaveLength(0);
	});
});

describe("ReasoningBlock", () => {
	it("keeps a grouped thought collapsed by default", () => {
		const { root } = render(
			<ReasoningStateProvider>
				<AssistantMessage message={reasoningMessage("Let me look around.")} />
			</ReasoningStateProvider>,
		);
		expect(containsText(root, "Let me look around.")).toBe(false);
		const trigger = findByLabelPrefix(root, "Thinking");
		expect(trigger?.props.accessibilityState).toEqual({ expanded: false });
		expect(trigger?.props.accessibilityLabel).toBe("Thinking, expand");
	});

	it("is still collapsible, and the a11y state follows", () => {
		const { root } = render(
			<ReasoningStateProvider>
				<AssistantMessage message={reasoningMessage("Let me look around.")} />
			</ReasoningStateProvider>,
		);
		act(() => {
			findByLabelPrefix(root, "Thinking")?.props.onPress();
		});
		expect(containsText(root, "Let me look around.")).toBe(true);
		const trigger = findByLabelPrefix(root, "Thinking");
		expect(trigger?.props.accessibilityState).toEqual({ expanded: true });
		expect(trigger?.props.accessibilityLabel).toBe("Thinking, collapse");
	});

	it("remembers an expansion across unmount — the virtualised-list case", () => {
		const message = reasoningMessage("Let me look around.");
		function Transcript({ mounted }: { mounted: boolean }) {
			return (
				<ReasoningStateProvider>
					{mounted ? <AssistantMessage message={message} /> : null}
				</ReasoningStateProvider>
			);
		}
		const { root, renderer } = render(<Transcript mounted />);
		act(() => {
			findByLabelPrefix(root, "Thinking")?.props.onPress();
		});
		expect(containsText(root, "Let me look around.")).toBe(true);

		// Scroll the row out of the window, then back in.
		act(() => renderer.update(<Transcript mounted={false} />));
		act(() => renderer.update(<Transcript mounted />));

		expect(containsText(root, "Let me look around.")).toBe(true);
		expect(
			findByLabelPrefix(root, "Thinking")?.props.accessibilityState,
		).toEqual({ expanded: true });
	});

	it("keeps each block's collapse state separate", () => {
		const { root } = render(
			<ReasoningStateProvider>
				<AssistantMessage
					message={reasoningMessage("first thought", { id: "a1" })}
				/>
				<AssistantMessage
					message={reasoningMessage("second thought", { id: "a2" })}
				/>
			</ReasoningStateProvider>,
		);
		const triggers = root.findAll(
			(node) =>
				typeof node.type === "string" &&
				node.props.accessibilityLabel === "Thinking, expand",
		);
		act(() => {
			triggers[0]?.props.onPress();
		});
		expect(containsText(root, "first thought")).toBe(true);
		expect(containsText(root, "second thought")).toBe(false);
	});

	it("groups consecutive reasoning blocks and reports their duration", () => {
		const message: SessionMessageView = {
			id: "a-group",
			role: "assistant",
			origin: "live",
			blocks: [
				{ kind: "reasoning", text: "first", redacted: false, startedAt: 1_000 },
				{
					kind: "reasoning",
					text: "second",
					redacted: false,
					completedAt: 4_200,
				},
				{ kind: "text", text: "answer" },
			],
		};
		const { root } = render(
			<ReasoningStateProvider>
				<AssistantMessage message={message} />
			</ReasoningStateProvider>,
		);
		expect(
			findByLabelPrefix(root, "Thought for 3s")?.props.accessibilityState,
		).toEqual({ expanded: false });
		expect(
			root.findAll(
				(node) =>
					typeof node.type === "string" &&
					node.props.accessibilityLabel === "Thought for 3s, expand",
			),
		).toHaveLength(1);
	});

	it("clamps a long thought behind a working Show more", () => {
		const long = Array.from(
			{ length: 40 },
			(_, index) => `thinking step number ${index}`,
		).join("\n");
		const { root } = render(
			<ReasoningStateProvider>
				<AssistantMessage message={reasoningMessage(long)} />
			</ReasoningStateProvider>,
		);
		act(() => findByLabelPrefix(root, "Thinking")?.props.onPress());
		// Expanded, but clamped: the text node caps its line count.
		const clamped = root
			.findAll(
				(node) =>
					typeof node.type === "string" && node.props.numberOfLines === 8,
			)
			.at(-1);
		expect(clamped).toBeDefined();
		expect(containsText(root, "Show more")).toBe(true);

		const showMore = findByLabelPrefix(root, "Show more reasoning");
		expect(showMore?.props.accessibilityState).toEqual({ expanded: false });
		act(() => {
			showMore?.props.onPress();
		});

		expect(containsText(root, "Show less")).toBe(true);
		expect(
			root
				.findAll(
					(node) =>
						typeof node.type === "string" && node.props.numberOfLines === 8,
				)
				.at(-1),
		).toBeUndefined();
		expect(
			findByLabelPrefix(root, "Show less reasoning")?.props.accessibilityState,
		).toEqual({ expanded: true });
	});

	it("does not clamp a short thought", () => {
		const { root } = render(
			<ReasoningStateProvider>
				<AssistantMessage message={reasoningMessage("short and sweet")} />
			</ReasoningStateProvider>,
		);
		expect(containsText(root, "Show more")).toBe(false);
	});

	it("renders redacted reasoning as a label with no body and no clamp", () => {
		const { root } = render(
			<ReasoningStateProvider>
				<AssistantMessage
					message={reasoningMessage("x".repeat(2000), { redacted: true })}
				/>
			</ReasoningStateProvider>,
		);
		expect(containsText(root, "Redacted reasoning")).toBe(true);
		expect(containsText(root, "Show more")).toBe(false);
		expect(allText(root)).not.toContain("xxxx");
	});

	it("toggles without a provider, it just forgets on unmount", () => {
		const { root } = render(
			<AssistantMessage message={reasoningMessage("standalone")} />,
		);
		expect(containsText(root, "standalone")).toBe(false);
		act(() => {
			findByLabelPrefix(root, "Thinking")?.props.onPress();
		});
		expect(containsText(root, "standalone")).toBe(true);
	});
});

describe("ToolActivityCard", () => {
	it("opens file diffs immediately and keeps completed rows quiet", () => {
		const message: SessionMessageView = {
			id: "edit-1",
			role: "assistant",
			origin: "live",
			blocks: [
				{
					kind: "tool",
					toolCallId: "tool-1",
					name: "apply_patch",
					state: "completed",
					input: {
						input:
							"*** Begin Patch\n*** Update File: a.ts\n@@\n-old\n+new\n*** End Patch",
					},
				},
			],
		};
		const { root } = render(<AssistantMessage message={message} />);
		const tool = findByLabelPrefix(root, "Tool ");
		expect(tool?.props.accessibilityState).toEqual({ expanded: true });
		expect(containsText(root, "a.ts")).toBe(true);
	});

	it("uses the spinner, not violet text, as the live-tool signal", () => {
		const message: SessionMessageView = {
			id: "run-1",
			role: "assistant",
			origin: "live",
			blocks: [
				{
					kind: "tool",
					toolCallId: "tool-1",
					name: "run_commands",
					state: "running",
					input: { command: "bun test" },
				},
			],
		};
		const { root } = render(<AssistantMessage message={message} />);
		expect(hasStyle(root, "color", "#b0b4ba")).toBe(true);
		expect(hasStyle(root, "color", "#a486fd")).toBe(false);
	});
});

describe("Generated media", () => {
	it("renders a persisted Cloud image from validated inline bytes", () => {
		const message: SessionMessageView = {
			id: "media-1",
			role: "assistant",
			origin: "hydrated",
			blocks: [
				{
					kind: "media",
					media: {
						id: "generated-1",
						modality: "image",
						mediaType: "image/png",
						source: {
							type: "base64",
							data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
						},
					},
				},
			],
		};
		const { root } = render(<AssistantMessage message={message} />);
		const image = root
			.findAll(
				(node) =>
					node.props.source?.uri ===
					"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
			)
			.at(0);
		expect(
			root.findAll(
				(node) => node.props.accessibilityLabel === "Generated image",
			),
		).not.toHaveLength(0);
		expect(image?.props.source).toEqual({
			uri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
		});
	});
});
