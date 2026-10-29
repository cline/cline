import type { PendingApprovalInfo } from "@cline/shared";
import * as Clipboard from "expo-clipboard";
import * as Native from "react-native";
import { FlatList } from "react-native";
import * as SafeArea from "react-native-safe-area-context";
import { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { SessionMessageView, SessionViewModel } from "@/session";
import {
	clearAllSessionDrafts,
	readSessionDraft,
	readSessionDraftImages,
} from "@/state/session-drafts";
import { render } from "../ui/__testing__/render";
import { flattenStyle } from "../ui/__testing__/rn-host";
import {
	containsText,
	emptyView,
	fakeConnection,
	findByLabel,
} from "./__testing__/harness";
import { ChatScreen, groupReasoningMessages } from "./ChatScreen";
import { ChatHeader } from "./chat/ChatHeader";
import { Composer } from "./chat/Composer";
import { ModelPill, ModelSheet } from "./chat/ModelControl";

const approval: PendingApprovalInfo = {
	approvalId: "ap1",
	sessionId: "s1",
	agentId: "agent",
	conversationId: "c1",
	iteration: 1,
	toolCallId: "tc1",
	toolName: "bash",
	inputJson: '{"command":"ls -la"}',
	policy: {},
	createdAt: Date.now(),
};

const richMessages: SessionMessageView[] = [
	{
		id: "h0",
		role: "user",
		origin: "hydrated",
		blocks: [{ kind: "text", text: "Hello" }],
	},
	{
		id: "a1",
		role: "assistant",
		origin: "live",
		blocks: [
			{ kind: "reasoning", text: "Let me look around.", redacted: false },
			{
				kind: "tool",
				toolCallId: "t1",
				name: "run_commands",
				state: "completed",
				input: { command: "ls -la" },
				output: "file1\nfile2",
			},
			{ kind: "text", text: "# Result\nDone with **bold** and `code`." },
		],
	},
	{
		id: "u2",
		role: "user",
		origin: "live",
		pending: true,
		failed: true,
		error: "network",
		blocks: [{ kind: "text", text: "retry me" }],
	},
];

function richView(): SessionViewModel {
	return {
		...emptyView(),
		connectionStatus: "live",
		runStatus: "running",
		messages: richMessages,
		pendingApprovals: [approval],
		usage: {
			turns: [],
			total: {
				inputTokens: 1200,
				outputTokens: 300,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0.042,
			},
		},
	};
}

describe("ChatScreen", () => {
	it("shows pending Stop, catches failure, and permits an explicit retry without duplicate requests", async () => {
		let fail = (_error: Error) => {};
		const abort = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise<void>((_resolve, reject) => {
						fail = reject;
					}),
			)
			.mockResolvedValue(undefined);
		const connection = fakeConnection({
			view: { ...emptyView(), runStatus: "running" },
			abort,
		});
		const screen = render(
			<ChatScreen connection={connection} connectionKind="cloud" />,
		);
		act(() => {
			screen.root.find((node) => node.type === Composer).props.onAbort();
			screen.root.find((node) => node.type === Composer).props.onAbort();
		});
		expect(abort).toHaveBeenCalledOnce();
		expect(containsText(screen.root, "Stopping Cline…")).toBe(true);
		await act(async () => {
			fail(new Error("Stop request failed"));
		});
		expect(containsText(screen.root, "Stop request failed")).toBe(true);
		await act(async () => {
			findByLabel(screen.root, "Retry stop")?.props.onPress();
		});
		expect(abort).toHaveBeenCalledTimes(2);
		expect(containsText(screen.root, "Stop request failed")).toBe(false);
	});

	it("gives Cloud approval guidance without referring to computer-only settings", () => {
		const connection = fakeConnection({
			view: { ...emptyView(), pendingApprovals: [approval] },
		});
		const screen = render(
			<ChatScreen connection={connection} connectionKind="cloud" />,
		);
		expect(containsText(screen.root, "then approve or deny the request")).toBe(
			true,
		);
		expect(containsText(screen.root, "Change Auto-approve below")).toBe(false);
		act(() =>
			screen.renderer.update(
				<ChatScreen connection={connection} connectionKind="local" />,
			),
		);
		expect(containsText(screen.root, "Change Auto-approve below")).toBe(true);
	});
	it("keeps asymmetric side safe areas on content when surfaces extend to the edges", () => {
		const insets = vi.spyOn(SafeArea, "useSafeAreaInsets").mockReturnValue({
			top: 0,
			bottom: 21,
			left: 62,
			right: 34,
		});
		try {
			const connection = fakeConnection();
			const { root, renderer, unmount } = render(
				<ChatScreen connection={connection} extendIntoSideInsets />,
			);
			const composer = root.find((node) => node.type === Composer);
			expect(composer.props.horizontalInsets).toEqual({ left: 62, right: 34 });
			expect(
				root.find((node) => node.type === ChatHeader).props.horizontalInsets,
			).toEqual({
				left: 62,
				right: 34,
			});
			expect(
				flattenStyle(
					root.find((node) => node.type === FlatList).props
						.contentContainerStyle,
				),
			).toMatchObject({ paddingLeft: 78, paddingRight: 50 });
			act(() => renderer.update(<ChatScreen connection={connection} />));
			expect(root.find((node) => node.type === Composer)).toBe(composer);
			expect(composer.props.horizontalInsets).toEqual({ left: 0, right: 0 });
			unmount();
		} finally {
			insets.mockRestore();
		}
	});
	it("shows inline Thinking only for a live, unblocked output wait", () => {
		const waiting = {
			...emptyView(),
			connectionStatus: "live" as const,
			runStatus: "running" as const,
			awaitingOutput: true,
		};
		const { root, renderer } = render(
			<ChatScreen connection={fakeConnection({ view: waiting })} />,
		);
		expect(containsText(root, "Thinking…")).toBe(true);
		for (const view of [
			{ ...waiting, awaitingOutput: undefined },
			{ ...waiting, connectionStatus: "reconnecting" as const },
			{ ...waiting, runStatus: "completed" as const },
			{ ...waiting, pendingApprovals: [approval] },
			{ ...waiting, lastError: "Unavailable" },
		]) {
			act(() =>
				renderer.update(<ChatScreen connection={fakeConnection({ view })} />),
			);
			expect(containsText(root, "Thinking…")).toBe(false);
		}
	});
	it("follows a newly sent user turn, not optimistic rekeys or history hydration", () => {
		const message: SessionMessageView = {
			id: "first",
			role: "user",
			origin: "live",
			blocks: [{ kind: "text", text: "First" }],
		};
		const view = {
			...emptyView(),
			connectionStatus: "live" as const,
			messages: [message],
		};
		const { root, renderer } = render(
			<ChatScreen connection={fakeConnection({ view })} />,
		);
		const list = () =>
			root.findAll((node) => node.props["data-name"] === "FlatList")[0];
		const scrollToOffset = vi.fn();
		root.findAll((node) => node.type === FlatList)[0].props.ref.current = {
			scrollToOffset,
		};
		const scrollUp = () =>
			act(() => {
				list().props.onContentSizeChange(400, 1600);
				list().props.onScrollBeginDrag();
				list().props.onScroll({
					nativeEvent: {
						contentOffset: { y: 0 },
						contentSize: { height: 1600 },
						layoutMeasurement: { height: 400 },
					},
				});
			});
		scrollUp();
		expect(findByLabel(root, "Jump to latest message")).toBeDefined();
		const sent = {
			...view,
			messages: [message, { ...message, id: "optimistic" }],
		};
		act(() =>
			renderer.update(
				<ChatScreen connection={fakeConnection({ view: sent })} />,
			),
		);
		expect(findByLabel(root, "Jump to latest message")).toBeUndefined();
		expect(scrollToOffset).toHaveBeenLastCalledWith({
			offset: 1600,
			animated: false,
		});
		scrollUp();
		const rekeyed = {
			...sent,
			messages: [message, { ...message, id: "persisted" }],
		};
		act(() =>
			renderer.update(
				<ChatScreen connection={fakeConnection({ view: rekeyed })} />,
			),
		);
		expect(findByLabel(root, "Jump to latest message")).toBeDefined();
		act(() =>
			renderer.update(
				<ChatScreen
					connection={fakeConnection({
						view: { ...rekeyed, connectionStatus: "hydrating" },
					})}
				/>,
			),
		);
		act(() =>
			renderer.update(
				<ChatScreen
					connection={fakeConnection({
						view: {
							...rekeyed,
							messages: [...rekeyed.messages, { ...message, id: "older" }],
						},
					})}
				/>,
			),
		);
		expect(findByLabel(root, "Jump to latest message")).toBeDefined();
	});
	it("shows a readable run failure without hiding the transcript or resending", () => {
		const sendInput = vi.fn();
		const view = {
			...emptyView(),
			connectionStatus: "live" as const,
			runStatus: "failed" as const,
			messages: richMessages.slice(0, 1),
			lastError:
				'{"error":{"message":"This model is not available for your account."}}',
		};
		const { root, renderer } = render(
			<ChatScreen connection={fakeConnection({ view, sendInput })} />,
		);
		expect(
			containsText(root, "This model is not available for your account."),
		).toBe(true);
		expect(containsText(root, '{"error"')).toBe(false);
		expect(containsText(root, "Hello")).toBe(true);
		expect(findByLabel(root, "Message composer")).toBeDefined();
		expect(sendInput).not.toHaveBeenCalled();
		act(() =>
			renderer.update(
				<ChatScreen
					connection={fakeConnection({
						view: { ...view, runStatus: "running" },
					})}
				/>,
			),
		);
		expect(
			containsText(root, "This model is not available for your account."),
		).toBe(false);
	});

	it.each([
		undefined,
		"{}",
		"run failed",
	])("shows a useful fallback for an unreadable run failure: %s", (lastError) => {
		const { root } = render(
			<ChatScreen
				connection={fakeConnection({
					view: {
						...emptyView(),
						connectionStatus: "live",
						runStatus: "failed",
						lastError,
					},
				})}
			/>,
		);
		expect(
			containsText(
				root,
				"Cline couldn't finish this turn. Try sending again or choose another model.",
			),
		).toBe(true);
	});

	it("keeps copy and timestamp controls on a single compact action row", () => {
		const { root } = render(
			<ChatScreen
				connection={fakeConnection({
					view: {
						...emptyView(),
						messages: [
							{
								id: "one",
								role: "user",
								origin: "hydrated",
								createdAt: Date.now(),
								blocks: [{ kind: "text", text: "Hello" }],
							},
						],
					},
				})}
			/>,
		);
		const row = root.find(
			(node) =>
				typeof node.type === "string" &&
				node.props.testID === "message-actions",
		);
		expect(flattenStyle(row.props.style).flexDirection).toBe("row");
		expect(findByLabel(row, "Copy user message")).toBeDefined();
		expect(findByLabel(row, "Show timestamp for user message")).toBeDefined();
	});
	it("copies user and assistant text without tool payloads or reasoning", async () => {
		const { root } = render(
			<ChatScreen connection={fakeConnection({ view: richView() })} />,
		);
		await act(async () =>
			findByLabel(root, "Copy assistant message")?.props.onPress(),
		);
		expect(Clipboard.setStringAsync).toHaveBeenLastCalledWith(
			"# Result\nDone with **bold** and `code`.",
		);
		const users = root.findAll(
			(node) =>
				typeof node.type === "string" &&
				node.props.accessibilityLabel === "Copy user message",
		);
		await act(async () => users[0]?.props.onPress());
		expect(Clipboard.setStringAsync).toHaveBeenLastCalledWith("Hello");
	});
	it("restores an unsent draft after switching away and back", () => {
		clearAllSessionDrafts();
		const first = render(
			<ChatScreen connection={fakeConnection()} draftKey="session-one" />,
		);
		act(() =>
			findByLabel(first.root, "Message composer")?.props.onChangeText(
				"Do not lose this",
			),
		);
		first.unmount();

		const second = render(
			<ChatScreen connection={fakeConnection()} draftKey="session-one" />,
		);
		expect(findByLabel(second.root, "Message composer")?.props.value).toBe(
			"Do not lose this",
		);
		second.unmount();
		clearAllSessionDrafts();
	});

	it("retires mounted chat text/images and ignores callbacks from the old signed-in epoch", () => {
		const mounted = render(
			<ChatScreen
				connection={fakeConnection({ status: { phase: "connecting" } })}
				draftKey="private-route"
				initialMessage="Private staged prompt"
				initialAttachments={{ userImages: ["data:image/jpeg;base64,/9j/"] }}
			/>,
		);
		const composer = mounted.root.find((node) => node.type === Composer);
		const oldTextChange = composer.props.onDraftChange;
		const oldImageChange = composer.props.onUserImagesChange;
		act(() => oldTextChange("Private edited draft"));
		expect(findByLabel(mounted.root, "Image 1")).toBeDefined();
		act(() => clearAllSessionDrafts());
		expect(findByLabel(mounted.root, "Message composer")!.props.value).toBe("");
		expect(findByLabel(mounted.root, "Image 1")).toBeUndefined();
		act(() => {
			oldTextChange("Late private result");
			oldImageChange(["data:image/jpeg;base64,/9j/"]);
		});
		expect(readSessionDraft("private-route")).toBeUndefined();
		expect(readSessionDraftImages("private-route")).toBeUndefined();
		expect(findByLabel(mounted.root, "Message composer")!.props.value).toBe("");
		mounted.unmount();
	});

	it("never sends a retired Home prompt when a pending durable-consumption callback resolves", async () => {
		const consumption = Promise.withResolvers<void>();
		const sendInput = vi.fn(async () => {});
		const mounted = render(
			<ChatScreen
				connection={fakeConnection({ sendInput })}
				initialMessage="Private pending Home prompt"
				onInitialMessageConsumed={() => consumption.promise}
			/>,
		);
		await act(async () => {});
		expect(sendInput).not.toHaveBeenCalled();
		act(() => clearAllSessionDrafts());
		await act(async () => consumption.resolve());
		expect(sendInput).not.toHaveBeenCalled();
		expect(findByLabel(mounted.root, "Message composer")!.props.value).toBe("");
		mounted.unmount();
	});

	it("moves an unsent Cloud draft when latest resolves to an exact session", () => {
		clearAllSessionDrafts();
		const first = render(
			<ChatScreen connection={fakeConnection()} draftKey="cloud:latest" />,
		);
		act(() =>
			findByLabel(first.root, "Message composer")?.props.onChangeText(
				"Keep this while Cloud resolves",
			),
		);
		act(() => {
			first.renderer.update(
				<ChatScreen connection={fakeConnection()} draftKey="cloud:session-1" />,
			);
		});
		first.unmount();

		const reopened = render(
			<ChatScreen connection={fakeConnection()} draftKey="cloud:session-1" />,
		);
		expect(findByLabel(reopened.root, "Message composer")?.props.value).toBe(
			"Keep this while Cloud resolves",
		);
		reopened.unmount();
		clearAllSessionDrafts();
	});

	it("offers a first-class session switcher from the chat header", () => {
		const onSwitchSession = vi.fn();
		const { root } = render(
			<ChatScreen
				connection={fakeConnection()}
				onSwitchSession={onSwitchSession}
			/>,
		);
		act(() => {
			findByLabel(root, "All sessions")?.props.onPress();
		});
		expect(onSwitchSession).toHaveBeenCalledOnce();
	});

	it("sends a Home submission exactly once when the selected connection is ready", async () => {
		const sendInput = vi.fn(async () => {});
		const onInitialMessageConsumed = vi.fn();
		const connection = fakeConnection({ sendInput });
		const { root } = render(
			<ChatScreen
				connection={connection}
				initialMessage="Start from Home"
				onInitialMessageConsumed={onInitialMessageConsumed}
			/>,
		);
		await act(async () => {});

		expect(sendInput).toHaveBeenCalledOnce();
		expect(sendInput).toHaveBeenCalledWith("Start from Home");
		expect(onInitialMessageConsumed).toHaveBeenCalledOnce();
		expect(findByLabel(root, "Message composer")?.props.value).toBe("");
	});

	it("does not send a durable Home submission before consumption persists", async () => {
		const sendInput = vi.fn(async () => {});
		const onSwitchSession = vi.fn();
		const { root } = render(
			<ChatScreen
				connection={fakeConnection({ sendInput })}
				initialMessage="Do this once"
				onInitialMessageConsumed={() =>
					Promise.reject(new Error("Keychain unavailable"))
				}
				onSwitchSession={onSwitchSession}
			/>,
		);
		await act(async () => {});

		expect(sendInput).not.toHaveBeenCalled();
		expect(findByLabel(root, "Message composer")?.props.value).toBe(
			"Do this once",
		);
		expect(findByLabel(root, "Retry saving this send")).toBeDefined();
		expect(findByLabel(root, "Send")?.props.accessibilityState.disabled).toBe(
			true,
		);
		expect(findByLabel(root, "All sessions")).toBeUndefined();
	});

	it("blocks manual send while durable consumption is pending", async () => {
		let finishConsumption: (() => void) | undefined;
		const consumption = new Promise<void>((resolve) => {
			finishConsumption = resolve;
		});
		const sendInput = vi.fn(async () => {});
		const onSwitchSession = vi.fn();
		const { root } = render(
			<ChatScreen
				connection={fakeConnection({ sendInput })}
				initialMessage="Send after saving"
				onInitialMessageConsumed={() => consumption}
				onSwitchSession={onSwitchSession}
			/>,
		);
		await act(async () => {});
		expect(findByLabel(root, "Send")?.props.accessibilityState.disabled).toBe(
			true,
		);
		expect(sendInput).not.toHaveBeenCalled();
		expect(findByLabel(root, "All sessions")).toBeUndefined();

		await act(async () => finishConsumption?.());
		expect(sendInput).toHaveBeenCalledOnce();
		expect(sendInput).toHaveBeenCalledWith("Send after saving");
		expect(findByLabel(root, "All sessions")).toBeDefined();
	});

	it("keeps a legacy image-only submission for the user to caption", async () => {
		const sendInput = vi.fn(async () => {});
		const onInitialMessageConsumed = vi.fn();
		const { root } = render(
			<ChatScreen
				connection={fakeConnection({ sendInput })}
				initialMessage=""
				initialAttachments={{ userImages: ["data:image/jpeg;base64,/9j/"] }}
				onInitialMessageConsumed={onInitialMessageConsumed}
			/>,
		);
		await act(async () => {});

		expect(sendInput).not.toHaveBeenCalled();
		expect(onInitialMessageConsumed).not.toHaveBeenCalled();
		expect(findByLabel(root, "Image 1")).toBeDefined();
		await act(async () => findByLabel(root, "Send")?.props.onPress());
		expect(
			containsText(
				root,
				"Add a message describing what you want Cline to do with the attached images.",
			),
		).toBe(true);
	});
	it("does not auto-send unsupported Home images or consume the draft", async () => {
		const sendInput = vi.fn(async () => {});
		const onInitialMessageConsumed = vi.fn();
		const { root } = render(
			<ChatScreen
				connection={fakeConnection({ sendInput })}
				initialMessage="Review screenshot"
				initialAttachments={{ userImages: ["data:image/jpeg;base64,/9j/"] }}
				supportsImages={false}
				onInitialMessageConsumed={onInitialMessageConsumed}
			/>,
		);
		await act(async () => {});
		expect(sendInput).not.toHaveBeenCalled();
		expect(onInitialMessageConsumed).not.toHaveBeenCalled();
		expect(findByLabel(root, "Message composer")?.props.value).toBe(
			"Review screenshot",
		);
		expect(findByLabel(root, "Image 1")).toBeDefined();
	});
	it.each([
		true,
		false,
		undefined,
	])("waits for initial image capability lookup (%s) before consuming Home submission", async (supportsImages) => {
		const sendInput = vi.fn(async () => {});
		const onInitialMessageConsumed = vi.fn();
		const props = {
			connection: fakeConnection({ sendInput }),
			initialMessage: "Review screenshot",
			initialAttachments: { userImages: ["data:image/jpeg;base64,/9j/"] },
			onInitialMessageConsumed,
		};
		const { root, renderer } = render(
			<ChatScreen {...props} checkingImageSupport />,
		);
		await act(async () => {});
		expect(sendInput).not.toHaveBeenCalled();
		expect(onInitialMessageConsumed).not.toHaveBeenCalled();
		expect(containsText(root, "Checking model image support…")).toBe(true);
		await act(async () =>
			renderer.update(
				<ChatScreen
					{...props}
					checkingImageSupport={false}
					supportsImages={supportsImages}
				/>,
			),
		);
		if (supportsImages === false) {
			expect(sendInput).not.toHaveBeenCalled();
			expect(onInitialMessageConsumed).not.toHaveBeenCalled();
			expect(findByLabel(root, "Image 1")).toBeDefined();
		} else {
			expect(sendInput).toHaveBeenCalledWith(
				"Review screenshot",
				props.initialAttachments,
			);
			expect(onInitialMessageConsumed).toHaveBeenCalledOnce();
		}
	});

	it("does not delay a text-only Home submission while checking image support", async () => {
		const sendInput = vi.fn(async () => {});
		render(
			<ChatScreen
				connection={fakeConnection({ sendInput })}
				initialMessage="Review code"
				checkingImageSupport
			/>,
		);
		await act(async () => {});
		expect(sendInput).toHaveBeenCalledWith("Review code");
	});

	it("sends Home image attachments with the initial submission", async () => {
		const sendInput = vi.fn(async () => {});
		const onInitialMessageConsumed = vi.fn();
		const { root } = render(
			<ChatScreen
				connection={fakeConnection({ sendInput })}
				initialMessage="Review this screenshot"
				initialAttachments={{ userImages: ["data:image/jpeg;base64,/9j/"] }}
				onInitialMessageConsumed={onInitialMessageConsumed}
			/>,
		);
		await act(async () => {});

		expect(sendInput).toHaveBeenCalledWith("Review this screenshot", {
			userImages: ["data:image/jpeg;base64,/9j/"],
		});
		expect(onInitialMessageConsumed).toHaveBeenCalledOnce();
		expect(findByLabel(root, "Image 1")).toBeUndefined();
	});

	it("retains staged images when the caption is edited while connecting", async () => {
		const sendInput = vi.fn(async () => {});
		const connecting = fakeConnection({
			status: { phase: "connecting" },
			sendInput,
		});
		const ready = fakeConnection({ sendInput });
		const props = {
			initialMessage: "Original caption",
			initialAttachments: { userImages: ["data:image/jpeg;base64,/9j/"] },
			onInitialMessageConsumed: vi.fn(),
		};
		const { root, renderer } = render(
			<ChatScreen connection={connecting} {...props} />,
		);
		expect(findByLabel(root, "Image 1")).toBeDefined();
		act(() => {
			findByLabel(root, "Message composer")?.props.onChangeText(
				"Edited caption",
			);
		});
		await act(async () => {
			renderer.update(<ChatScreen connection={ready} {...props} />);
		});

		expect(sendInput).not.toHaveBeenCalled();
		expect(findByLabel(root, "Image 1")).toBeDefined();
		expect(findByLabel(root, "Message composer")?.props.value).toBe(
			"Edited caption",
		);
	});

	it("restores an edited caption and image after switching sessions", async () => {
		clearAllSessionDrafts();
		const sendInput = vi.fn(async () => {});
		const props = {
			draftKey: "cloud:image-draft",
			initialMessage: "Original caption",
			initialAttachments: { userImages: ["data:image/jpeg;base64,/9j/"] },
			onInitialMessageConsumed: vi.fn(),
		};
		const first = render(
			<ChatScreen
				connection={fakeConnection({
					status: { phase: "connecting" },
					sendInput,
				})}
				{...props}
			/>,
		);
		act(() => {
			findByLabel(first.root, "Message composer")?.props.onChangeText(
				"Edited caption",
			);
		});
		await act(async () => {
			first.renderer.update(
				<ChatScreen connection={fakeConnection({ sendInput })} {...props} />,
			);
		});
		expect(sendInput).not.toHaveBeenCalled();
		first.unmount();

		const reopened = render(
			<ChatScreen
				connection={fakeConnection({ sendInput })}
				draftKey="cloud:image-draft"
			/>,
		);
		expect(findByLabel(reopened.root, "Message composer")?.props.value).toBe(
			"Edited caption",
		);
		expect(findByLabel(reopened.root, "Image 1")).toBeDefined();
		reopened.unmount();
		clearAllSessionDrafts();
	});

	it("does not consume an image-only submission removed while connecting", async () => {
		const sendInput = vi.fn(async () => {});
		const onInitialMessageConsumed = vi.fn();
		const connecting = fakeConnection({
			status: { phase: "connecting" },
			sendInput,
		});
		const ready = fakeConnection({ sendInput });
		const props = {
			initialMessage: "",
			initialAttachments: { userImages: ["data:image/jpeg;base64,/9j/"] },
			onInitialMessageConsumed,
		};
		const { root, renderer } = render(
			<ChatScreen connection={connecting} {...props} />,
		);
		act(() => {
			findByLabel(root, "Remove Image 1")?.props.onPress();
		});
		await act(async () => {
			renderer.update(<ChatScreen connection={ready} {...props} />);
		});

		expect(sendInput).not.toHaveBeenCalled();
		expect(onInitialMessageConsumed).not.toHaveBeenCalled();
		expect(findByLabel(root, "Image 1")).toBeUndefined();
	});

	it("keeps a Home submission visible while its target is still connecting", () => {
		const sendInput = vi.fn(async () => {});
		const { root } = render(
			<ChatScreen
				connection={fakeConnection({
					status: { phase: "connecting" },
					sendInput,
				})}
				initialMessage="Wait for the machine"
			/>,
		);
		expect(findByLabel(root, "Message composer")?.props.value).toBe(
			"Wait for the machine",
		);
		expect(sendInput).not.toHaveBeenCalled();
		expect(findByLabel(root, "Send")?.props.accessibilityState.disabled).toBe(
			true,
		);
	});

	it("renders a rich transcript with markdown, tools, approvals and usage", () => {
		const { root, json } = render(
			<ChatScreen connection={fakeConnection({ view: richView() })} />,
		);
		expect(json).not.toBeNull();
		expect(containsText(root, "Hello")).toBe(true);
		expect(containsText(root, "Result")).toBe(true); // markdown heading
		expect(containsText(root, "Editing")).toBe(false); // run_commands isn't an edit
		expect(containsText(root, "Failed to send")).toBe(true);
		expect(containsText(root, "waiting")).toBe(true); // approval banner
		expect(containsText(root, "Tool approval required")).toBe(true); // sheet
	});

	it("keeps one model selector in the composer and secondary controls in model settings", () => {
		const { root } = render(
			<ChatScreen
				connectionKind="local"
				connection={fakeConnection({ view: richView() })}
				modelLabel="anthropic/claude-sonnet-5"
				modelName="Claude Sonnet 5"
				supportsReasoning
				onReasoningChange={vi.fn()}
				onFork={vi.fn(async () => {})}
			/>,
		);
		const composer = root.find((node) => node.type === Composer);
		expect(composer.props.controls.type).toBe(ModelPill);
		expect(findByLabel(root, "Model: Claude Sonnet 5")).toBeDefined();
		const modelSheet = root.find((node) => node.type === ModelSheet);
		expect(modelSheet.props.settings).toBeTypeOf("function");
		// Settings stay available from the model sheet without adding permanent
		// approval/checkpoint/reasoning pills to the composer toolbar.
		expect(containsText(root, "Auto: all")).toBe(true);
		expect(findByLabel(root, "Fork from checkpoint")).toBeDefined();
		expect(findByLabel(root, "Thinking level: Model setting")).toBeDefined();
	});

	it("does not double-count the in-app header in the keyboard offset", () => {
		const { root } = render(
			<ChatScreen connection={fakeConnection({ view: richView() })} />,
		);
		// The KAV already begins below the in-app header, so adding the header again
		// would float the composer above the keyboard.
		const kav = root
			.findAll(
				(node) =>
					typeof node.type === "string" && node.type === "KeyboardAvoidingView",
			)
			.at(0);
		expect(kav?.props.automaticOffset).toBe(true);
		expect(kav?.props.keyboardVerticalOffset).toBeUndefined();
	});

	it("shows stop while running and adds send when a prompt can be queued", () => {
		const { root } = render(
			<ChatScreen connection={fakeConnection({ view: richView() })} />,
		);
		expect(
			root.findAll((node) => node.props.accessibilityLabel === "Send"),
		).toHaveLength(0);
		act(() =>
			root
				.find((node) => node.props.accessibilityLabel === "Message composer")
				.props.onChangeText("Follow up while running"),
		);
		expect(
			root.findAll((node) => node.props.accessibilityLabel === "Send").length,
		).toBeGreaterThan(0);
		expect(
			root.findAll((node) => node.props.accessibilityLabel === "Abort").length,
		).toBeGreaterThan(0);
	});

	it("re-enables a rejected approval and shows a retryable error", async () => {
		const respondApproval = vi.fn(async () => {
			throw new Error("offline");
		});
		const { root } = render(
			<ChatScreen
				connection={fakeConnection({
					view: richView(),
					respondApproval,
				})}
			/>,
		);
		const approve = root
			.findAll((node) => node.props.accessibilityLabel === "Approve")
			.at(-1);
		expect(approve).toBeDefined();
		await act(async () => {
			approve?.props.onPress();
		});
		expect(respondApproval).toHaveBeenCalledWith("ap1", true, undefined);
		expect(containsText(root, "Could not send your response")).toBe(true);
		expect(approve?.props.disabled).toBe(false);
	});

	it("renders markdown links as interactive links", () => {
		const view = richView();
		view.messages = [
			{
				id: "link",
				role: "assistant",
				origin: "live",
				blocks: [{ kind: "text", text: "Open [Cline](https://cline.bot)" }],
			},
		];
		const { root } = render(
			<ChatScreen connection={fakeConnection({ view })} />,
		);
		const links = root.findAll(
			(node) => node.props.accessibilityRole === "link",
		);
		expect(links.length).toBeGreaterThan(0);
		expect(links.some((link) => typeof link.props.onPress === "function")).toBe(
			true,
		);
	});

	it("budgets Android composer height against the visible keyboard in its full-height edge-to-edge window", () => {
		const previousOS = Native.Platform.OS;
		Native.Platform.OS = "android";
		const handlers = new Map<string, (event: unknown) => void>();
		const listen = vi
			.spyOn(Native.Keyboard, "addListener")
			.mockImplementation((name, handler) => {
				handlers.set(name, handler as (event: unknown) => void);
				return {
					remove: () => {
						handlers.delete(name);
					},
				} as ReturnType<typeof Native.Keyboard.addListener>;
			});
		const dimensions = vi
			.spyOn(Native, "useWindowDimensions")
			.mockReturnValue({ width: 402, height: 874, scale: 3, fontScale: 1 });
		try {
			const app = render(<ChatScreen connection={fakeConnection()} />);
			const originalHeight = app.root.find((node) => node.type === Composer)
				.props.maxHeight;
			act(() =>
				handlers.get("keyboardDidShow")?.({ endCoordinates: { height: 300 } }),
			);
			expect(
				app.root.find((node) => node.type === Composer).props.maxHeight,
			).toBeCloseTo(originalHeight - 210);
			act(() => handlers.get("keyboardDidHide")?.({}));
			expect(
				app.root.find((node) => node.type === Composer).props.maxHeight,
			).toBe(originalHeight);
			dimensions.mockReturnValue({
				width: 874,
				height: 320,
				scale: 3,
				fontScale: 1,
			});
			act(() =>
				app.renderer.update(<ChatScreen connection={fakeConnection()} />),
			);
			act(() =>
				handlers.get("keyboardDidShow")?.({ endCoordinates: { height: 220 } }),
			);
			const chrome = () =>
				app.root.find(
					(node) =>
						typeof node.type === "string" &&
						node.props.testID === "chat-context-chrome",
				);
			expect(chrome().props.style.display).toBe("none");
			act(() => handlers.get("keyboardDidHide")?.({}));
			expect(chrome().props.style.display).toBe("flex");
			act(() => app.renderer.unmount());
		} finally {
			Native.Platform.OS = previousOS;
			listen.mockRestore();
			dimensions.mockRestore();
		}
	});

	it("shows a quiet labelled state before the first message arrives", () => {
		const { root } = render(
			<ChatScreen
				title="dev hub"
				connection={fakeConnection({ status: { phase: "connecting" } })}
			/>,
		);
		expect(containsText(root, "Opening session")).toBe(true);
		const message = root.findAll(
			(node) =>
				typeof node.type === "string" &&
				node.props.children === "Opening session…",
		)[0];
		expect(message).toBeDefined();
		for (let ancestor = message?.parent; ancestor; ancestor = ancestor.parent) {
			expect(ancestor.props.accessibilityElementsHidden).not.toBe(true);
		}
	});

	it("shows an error state with a retry that calls reconnect", async () => {
		const reconnect = vi.fn(async () => {});
		const { root } = render(
			<ChatScreen
				connection={fakeConnection({
					status: { phase: "error", error: new Error("boom") },
					reconnect,
				})}
			/>,
		);
		expect(containsText(root, "Couldn't start the session")).toBe(true);
		const retry = findByLabel(root, "Retry");
		expect(retry).toBeDefined();
		await act(async () => {
			retry?.props.onPress();
		});
		expect(reconnect).toHaveBeenCalledTimes(1);
	});

	it("keeps drafting available during a connection error but blocks Send", () => {
		const sendInput = vi.fn(async () => {});
		const { root } = render(
			<ChatScreen
				connection={fakeConnection({
					status: { phase: "error", error: new Error("offline") },
					sendInput,
				})}
			/>,
		);
		const composer = findByLabel(root, "Message composer");
		expect(composer?.props.editable).not.toBe(false);
		act(() => composer?.props.onChangeText("Keep this draft"));
		expect(findByLabel(root, "Message composer")?.props.value).toBe(
			"Keep this draft",
		);
		expect(findByLabel(root, "Send")?.props.accessibilityState.disabled).toBe(
			true,
		);
		expect(sendInput).not.toHaveBeenCalled();
	});

	it("makes the native composer input a full touch target", () => {
		const { root } = render(<ChatScreen connection={fakeConnection()} />);
		const composer = findByLabel(root, "Message composer");
		expect(flattenStyle(composer?.props.style).minHeight).toBe(44);
		expect(composer?.props.editable).toBe(true);
		expect(composer?.props.showSoftInputOnFocus).toBe(true);
	});

	it("keeps bottom-sheet gesture surfaces outside the composer and exposes only the model control there", () => {
		const { root } = render(
			<ChatScreen connection={fakeConnection()} connectionKind="local" />,
		);
		const composer = root.find((node) => node.type === Composer);
		expect(composer.props.controls.type).toBe(ModelPill);
		expect(
			root.findAll((node) => node.props.testID === "composer-controls"),
		).toHaveLength(0);
		// An absent/resolved question sheet is unmounted so rotation cannot reopen it.
		expect(root.findAll((node) => node.type === "BottomSheet")).toHaveLength(3);
	});

	it("answers Cline questions through the same session connection", async () => {
		const respondQuestion = vi.fn(async () => {});
		const view = emptyView();
		view.pendingQuestions = [
			{
				requestId: "capreq_1",
				question: "Which implementation?",
				options: ["Use Hub", "Use REST"],
			},
		];
		const { root } = render(
			<ChatScreen connection={fakeConnection({ view, respondQuestion })} />,
		);
		expect(containsText(root, "Which implementation?")).toBe(true);
		await act(async () => findByLabel(root, "A. Use Hub")?.props.onPress());
		expect(respondQuestion).toHaveBeenCalledWith("capreq_1", "Use Hub");
	});

	it("explains a question cancelled by disconnect without resubmitting anything", () => {
		const sendInput = vi.fn();
		const respondQuestion = vi.fn();
		const { root } = render(
			<ChatScreen
				connection={fakeConnection({
					view: { ...emptyView(), questionInterrupted: true },
					sendInput,
					respondQuestion,
				})}
			/>,
		);
		expect(
			containsText(
				root,
				"The connection interrupted Cline's question. Ask Cline to repeat it when you're connected again.",
			),
		).toBe(true);
		expect(findByLabel(root, "Answer Cline's question")).toBeUndefined();
		expect(sendInput).not.toHaveBeenCalled();
		expect(respondQuestion).not.toHaveBeenCalled();
	});

	it("warns on a closed live transport and offers reconnect", async () => {
		const reconnect = vi.fn(async () => {});
		const view = emptyView();
		view.connectionStatus = "closed";
		const { root } = render(
			<ChatScreen connection={fakeConnection({ view, reconnect })} />,
		);
		expect(containsText(root, "Connection lost")).toBe(true);
		const warning = findByLabel(root, "Connection lost. Reconnect");
		expect(warning).toBeDefined();
		await act(async () => warning?.props.onPress());
		expect(reconnect).toHaveBeenCalledOnce();
	});

	it("demotes the raw error into a reachable Details disclosure", () => {
		const { root } = render(
			<ChatScreen
				connection={fakeConnection({
					status: {
						phase: "error",
						error: Object.assign(
							new Error(
								"Failed to connect to hub at ws://127.0.0.1:4599/hub (error event before socket open).",
							),
							{ name: "HubTransportError", code: "hub_connect_failed" },
						),
					},
				})}
			/>,
		);
		// A transport failure gets human copy; the url is NOT the headline.
		expect(containsText(root, "Can't reach this session")).toBe(true);
		expect(containsText(root, "ws://127.0.0.1:4599/hub")).toBe(false);

		const details = findByLabel(root, "Technical error details, expand");
		expect(details).toBeDefined();
		act(() => {
			details?.props.onPress();
		});
		expect(containsText(root, "ws://127.0.0.1:4599/hub")).toBe(true);
	});

	it("offers an escape back to the session list, and drops Retry when it cannot help", () => {
		const onChooseAnotherSession = vi.fn();
		const { root } = render(
			<ChatScreen
				connection={fakeConnection({
					status: {
						phase: "error",
						error: Object.assign(new Error("client too old"), {
							name: "IncompatibleProtocolError",
							code: "incompatible_protocol",
						}),
					},
				})}
				onChooseAnotherSession={onChooseAnotherSession}
			/>,
		);
		expect(containsText(root, "Version mismatch")).toBe(true);
		expect(findByLabel(root, "Retry")).toBeUndefined();
		const escapeHatch = findByLabel(root, "Choose another session");
		expect(escapeHatch).toBeDefined();
		act(() => {
			escapeHatch?.props.onPress();
		});
		expect(onChooseAnotherSession).toHaveBeenCalledTimes(1);
	});

	it("styles the reconnecting banner as a labelled inline banner", () => {
		const view = emptyView();
		view.connectionStatus = "reconnecting";
		const { root } = render(
			<ChatScreen connection={fakeConnection({ view })} />,
		);
		expect(
			containsText(root, "Reconnecting — your session is preserved."),
		).toBe(true);
	});

	it("structures the header around human session and location labels", () => {
		const { root } = render(
			<ChatScreen
				title="Fix the flaky test"
				subtitle="MacBook Pro"
				connection={fakeConnection({ view: richView() })}
			/>,
		);
		expect(containsText(root, "Fix the flaky test")).toBe(true);
		expect(containsText(root, "MacBook Pro")).toBe(true);
		expect(containsText(root, "ws://")).toBe(false);
		// The header reflects the pending approval rather than claiming execution.
		expect(containsText(root, "Waiting for approval")).toBe(true);
	});

	it("does not duplicate back-to-sessions or auto-approve in the header", () => {
		const { root } = render(
			<ChatScreen connection={fakeConnection({ view: richView() })} />,
		);
		expect(findByLabel(root, "Sessions")).toBeUndefined();
		expect(findByLabel(root, "Auto-approve settings")).toBeUndefined();
	});

	it("tells the user other tiers may be auto-approved", () => {
		const { root } = render(
			<ChatScreen connection={fakeConnection({ view: richView() })} />,
		);
		expect(containsText(root, "Tiers set to")).toBe(true);
	});

	it("keeps an empty transcript quiet so Home remains the only welcome", () => {
		const { root } = render(<ChatScreen connection={fakeConnection()} />);
		expect(containsText(root, "Ready when you are")).toBe(false);
		expect(findByLabel(root, "Message composer")).toBeDefined();
	});

	it("keeps following during initial native layout before any user scroll", () => {
		const { root } = render(
			<ChatScreen connection={fakeConnection({ view: richView() })} />,
		);
		const list = root
			.findAll((node) => node.props["data-name"] === "FlatList")
			.at(0);
		const scrollToOffset = vi.fn();
		root.findAll((node) => node.type === FlatList)[0].props.ref.current = {
			scrollToOffset,
		};
		act(() => {
			list?.props.onScroll({
				nativeEvent: {
					contentOffset: { y: 0 },
					contentSize: { height: 4000 },
					layoutMeasurement: { height: 400 },
				},
			});
			list?.props.onLayout();
			list?.props.onContentSizeChange(400, 4000);
		});
		expect(findByLabel(root, "Jump to latest message")).toBeUndefined();
		expect(scrollToOffset).toHaveBeenLastCalledWith({
			offset: 4000,
			animated: false,
		});
		act(() => list?.props.onContentSizeChange(400, 4800));
		expect(scrollToOffset).toHaveBeenLastCalledWith({
			offset: 4800,
			animated: false,
		});
		scrollToOffset.mockClear();
		act(() => list?.props.onLayout());
		expect(scrollToOffset).toHaveBeenCalledWith({
			offset: 4800,
			animated: false,
		});
	});

	it("shows a jump-to-latest action when the user scrolls away from the tail", () => {
		const { root } = render(
			<ChatScreen connection={fakeConnection({ view: richView() })} />,
		);
		const list = root
			.findAll((node) => node.props["data-name"] === "FlatList")
			.at(0);
		const scrollToOffset = vi.fn();
		root.findAll((node) => node.type === FlatList)[0].props.ref.current = {
			scrollToOffset,
		};
		act(() => {
			list?.props.onScrollBeginDrag();
			list?.props.onScroll({
				nativeEvent: {
					contentOffset: { y: 0 },
					contentSize: { height: 1200 },
					layoutMeasurement: { height: 400 },
				},
			});
		});
		const jump = findByLabel(root, "Jump to latest message");
		expect(jump).toBeDefined();
		scrollToOffset.mockClear();
		act(() => list?.props.onContentSizeChange(400, 1600));
		expect(scrollToOffset).not.toHaveBeenCalled();
		act(() => jump?.props.onPress());
		expect(scrollToOffset).toHaveBeenCalledWith({
			offset: 1600,
			animated: true,
		});
		expect(findByLabel(root, "Jump to latest message")).toBeUndefined();
	});

	it("keeps the running tool in the transcript without a duplicate activity bar", () => {
		const view = richView();
		view.messages = [
			...view.messages,
			{
				id: "a-running",
				role: "assistant",
				origin: "live",
				blocks: [
					{
						kind: "tool",
						toolCallId: "tc-live",
						name: "editor",
						state: "running",
						input: { path: "Composer.tsx", old_text: "a", new_text: "b" },
						startedAt: Date.now() - 12_000,
					},
				],
			},
		];
		const { root } = render(
			<ChatScreen connection={fakeConnection({ view })} />,
		);
		// The running tool already appears in the transcript at the live tail.
		expect(root.findAll((node) => node.props.testID === "now-strip")).toEqual(
			[],
		);
		expect(containsText(root, "Editing file Composer.tsx")).toBe(true);
		const list = root.findAll(
			(node) => node.props["data-name"] === "FlatList",
		)[0];
		const scrollToOffset = vi.fn();
		root.findAll((node) => node.type === FlatList)[0].props.ref.current = {
			scrollToOffset,
		};
		act(() => {
			list.props.onContentSizeChange(400, 1600);
			list.props.onScrollBeginDrag();
			list.props.onScroll({
				nativeEvent: {
					contentOffset: { y: 0 },
					contentSize: { height: 1600 },
					layoutMeasurement: { height: 400 },
				},
			});
		});
		expect(
			root.findAll(
				(node) =>
					typeof node.type === "string" && node.props.testID === "now-strip",
			),
		).toHaveLength(0);
		expect(findByLabel(root, "Jump to latest message")).toBeDefined();
		act(() => findByLabel(root, "Jump to latest message")?.props.onPress());
		expect(scrollToOffset).toHaveBeenLastCalledWith({
			offset: 1600,
			animated: true,
		});
		expect(root.findAll((node) => node.props.testID === "now-strip")).toEqual(
			[],
		);
	});

	it("does not claim a historical tool is active after the run ends", () => {
		const view = richView();
		view.runStatus = "completed";
		view.messages = [
			{
				id: "h-orphan",
				role: "assistant",
				origin: "hydrated",
				blocks: [
					{
						kind: "tool",
						toolCallId: "tc-orphan",
						name: "editor",
						state: "running",
						input: { path: "stale.ts", new_text: "stale" },
					},
				],
			},
		];
		const { root } = render(
			<ChatScreen connection={fakeConnection({ view })} />,
		);
		expect(root.findAll((node) => node.props.testID === "now-strip")).toEqual(
			[],
		);
	});

	it("offers an accessible timestamp action without wrapping message controls", () => {
		const view = emptyView();
		view.messages = [
			{
				id: "a-timed",
				role: "assistant",
				origin: "live",
				createdAt: Date.now(),
				blocks: [{ kind: "text", text: "Timed answer" }],
			},
		];
		const { root } = render(
			<ChatScreen connection={fakeConnection({ view })} />,
		);
		const showTime = findByLabel(root, "Show timestamp for assistant message");
		expect(showTime).toBeDefined();
		act(() => showTime?.props.onPress());
		expect(containsText(root, "just now")).toBe(true);
	});
});

describe("reasoning transcript grouping", () => {
	it("folds reasoning-only assistant messages into the following answer", () => {
		const grouped = groupReasoningMessages([
			{
				id: "a1",
				role: "assistant",
				origin: "hydrated",
				blocks: [{ kind: "reasoning", text: "one", redacted: false }],
			},
			{
				id: "a2",
				role: "assistant",
				origin: "hydrated",
				blocks: [{ kind: "reasoning", text: "two", redacted: false }],
			},
			{
				id: "a3",
				role: "assistant",
				origin: "hydrated",
				blocks: [{ kind: "text", text: "answer" }],
			},
		]);
		expect(grouped).toHaveLength(1);
		expect(grouped[0]?.blocks).toHaveLength(3);
	});

	it("keeps the grouped row identity stable when the answer arrives", () => {
		const reasoning: SessionMessageView = {
			id: "a1",
			role: "assistant",
			origin: "live",
			blocks: [{ kind: "reasoning", text: "thinking", redacted: false }],
		};
		const before = groupReasoningMessages([reasoning]);
		const after = groupReasoningMessages([
			reasoning,
			{
				id: "a2",
				role: "assistant",
				origin: "live",
				blocks: [{ kind: "text", text: "answer" }],
			},
		]);
		expect(before[0]?.id).toBe("a1");
		expect(after[0]?.id).toBe("a1");
	});
});

describe("ChatScreen queued prompts", () => {
	it("shows the machine's turn queue and wires removal to the hub", async () => {
		const view = emptyView();
		view.pendingPrompts = [
			{
				id: "pp_1",
				prompt: "then run the tests",
				delivery: "queue",
				attachmentCount: 0,
			},
		];
		const removePendingPrompt = vi.fn(async () => {});
		const { root } = render(
			<ChatScreen connection={fakeConnection({ view, removePendingPrompt })} />,
		);
		expect(containsText(root, "then run the tests")).toBe(true);

		const [remove] = root.findAll(
			(node) =>
				node.props.accessibilityLabel ===
				'Remove "then run the tests" from the queue',
		);
		(remove?.props.onPress as () => void)();
		expect(removePendingPrompt).toHaveBeenCalledWith("pp_1");
	});

	it("shows no queue strip when the machine is holding nothing", () => {
		const { root } = render(<ChatScreen connection={fakeConnection()} />);
		expect(
			root.findAll((node) => node.props.testID === "queued-prompts"),
		).toHaveLength(0);
	});
});

describe("run outcome card", () => {
	function finishedRunView(): SessionViewModel {
		const view = richView();
		view.runStatus = "completed";
		view.lastRun = { startedAt: 1_000, endedAt: 135_000, outcome: "completed" };
		// The run being summarized is the transcript's TAIL: a user ask followed
		// by assistant activity, exactly as a completed run leaves it.
		view.messages = [
			...richMessages.slice(0, 2),
			{
				id: "u9",
				role: "user",
				origin: "live",
				blocks: [{ kind: "text", text: "fix the bug" }],
			},
			{
				id: "a9",
				role: "assistant",
				origin: "live",
				blocks: [
					{
						kind: "tool",
						toolCallId: "t9",
						name: "edit_file",
						state: "completed",
						input: { path: "src/fix.ts", old_text: "", new_text: "done" },
					},
					{ kind: "text", text: "Fixed." },
				],
			},
		];
		return view;
	}

	it("summarizes a watched run under the transcript", () => {
		const { root } = render(
			<ChatScreen connection={fakeConnection({ view: finishedRunView() })} />,
		);
		expect(
			root.findAll(
				(node) =>
					typeof node.type === "string" && node.props.testID === "run-summary",
			),
		).toHaveLength(1);
		expect(containsText(root, "Run finished")).toBe(true);
		expect(containsText(root, "2m 14s")).toBe(true);
	});

	it("shows no card for a run this client never watched", () => {
		const view = richView();
		view.runStatus = "completed";
		// No lastRun: the transcript was hydrated after the fact.
		const { root } = render(
			<ChatScreen connection={fakeConnection({ view })} />,
		);
		expect(
			root.findAll(
				(node) =>
					typeof node.type === "string" && node.props.testID === "run-summary",
			),
		).toHaveLength(0);
	});

	it("drops the card the moment a new run starts", () => {
		const view = finishedRunView();
		view.runStatus = "running";
		const { root } = render(
			<ChatScreen connection={fakeConnection({ view })} />,
		);
		expect(
			root.findAll(
				(node) =>
					typeof node.type === "string" && node.props.testID === "run-summary",
			),
		).toHaveLength(0);
	});
});

it("never overwrites a Home draft the user edited while connecting", async () => {
	const sendInput = vi.fn(async () => {});
	let status: { phase: "connecting" | "ready" } = { phase: "connecting" };
	const connection = fakeConnection({ status, sendInput });
	const { root, renderer } = render(
		<ChatScreen connection={connection} initialMessage="original ask" />,
	);
	// The user edits the staged text during the connect window.
	const composer = findByLabel(root, "Message composer");
	act(() => {
		(composer?.props.onChangeText as (t: string) => void)(
			"original ask plus my edit",
		);
	});
	// Connection becomes ready.
	status = { phase: "ready" };
	await act(async () => {
		renderer.update(
			<ChatScreen
				connection={fakeConnection({ status, sendInput })}
				initialMessage="original ask"
			/>,
		);
	});
	// The stale original must not be sent, and the edit must survive.
	expect(sendInput).not.toHaveBeenCalled();
	expect(findByLabel(root, "Message composer")?.props.value).toBe(
		"original ask plus my edit",
	);
});

it("removes stale run status while reconnecting and shows the new authoritative status once live", () => {
	const view = richView();
	const screen = render(<ChatScreen connection={fakeConnection({ view })} />);
	expect(containsText(screen.root, "Waiting for approval")).toBe(true);
	for (const connectionStatus of ["reconnecting", "closed", "error"] as const) {
		act(() =>
			screen.renderer.update(
				<ChatScreen
					connection={fakeConnection({ view: { ...view, connectionStatus } })}
				/>,
			),
		);
		expect(containsText(screen.root, "Waiting for approval")).toBe(false);
	}
	act(() =>
		screen.renderer.update(
			<ChatScreen
				connection={fakeConnection({
					view: { ...view, runStatus: "completed", pendingApprovals: [] },
				})}
			/>,
		),
	);
	expect(containsText(screen.root, "Completed")).toBe(true);
	screen.unmount();
});

describe("initial Home send asynchronous ownership", () => {
	it("never overwrites a newer composer draft when the initial send rejects late", async () => {
		const send = Promise.withResolvers<void>();
		const sendInput = vi.fn(() => send.promise);
		const screen = render(
			<ChatScreen
				connection={fakeConnection({ sendInput })}
				draftKey="late-rejected-initial"
				initialMessage="Original Home prompt"
			/>,
		);
		await act(async () => {});
		expect(sendInput).toHaveBeenCalledOnce();
		act(() =>
			findByLabel(screen.root, "Message composer")?.props.onChangeText(
				"New follow-up draft",
			),
		);
		await act(async () => send.reject(new Error("Lost acknowledgement")));
		expect(findByLabel(screen.root, "Message composer")?.props.value).toBe(
			"New follow-up draft",
		);
		expect(readSessionDraft("late-rejected-initial")).toBe(
			"New follow-up draft",
		);
		screen.unmount();
	});
	it("rechecks image compatibility after durable consumption instead of sending into a newly text-only model", async () => {
		const consumption = Promise.withResolvers<void>();
		const sendInput = vi.fn(async () => {});
		const props = {
			connection: fakeConnection({ sendInput }),
			initialMessage: "Review screenshot",
			initialAttachments: { userImages: ["data:image/jpeg;base64,/9j/"] },
			onInitialMessageConsumed: () => consumption.promise,
		};
		const screen = render(<ChatScreen {...props} supportsImages />);
		await act(async () => {});
		act(() =>
			screen.renderer.update(<ChatScreen {...props} supportsImages={false} />),
		);
		await act(async () => consumption.resolve());
		expect(sendInput).not.toHaveBeenCalled();
		expect(findByLabel(screen.root, "Message composer")?.props.value).toBe(
			"Review screenshot",
		);
		expect(findByLabel(screen.root, "Image 1")).toBeDefined();
		await act(async () =>
			screen.renderer.update(<ChatScreen {...props} supportsImages />),
		);
		expect(sendInput).not.toHaveBeenCalled();
		await act(async () => findByLabel(screen.root, "Send")?.props.onPress());
		expect(sendInput).toHaveBeenCalledExactlyOnceWith(
			"Review screenshot",
			props.initialAttachments,
		);
		screen.unmount();
	});
});

it("treats a same-turn text edit as takeover before durable consumption resolves", async () => {
	const consumption = Promise.withResolvers<void>();
	const sendInput = vi.fn(async () => {});
	const screen = render(
		<ChatScreen
			connection={fakeConnection({ sendInput })}
			initialMessage="Original pending"
			onInitialMessageConsumed={() => consumption.promise}
		/>,
	);
	await act(async () => {});
	await act(async () => {
		findByLabel(screen.root, "Message composer")?.props.onChangeText(
			"Same-turn takeover",
		);
		consumption.resolve();
		await Promise.resolve();
	});
	expect(sendInput).not.toHaveBeenCalled();
	expect(findByLabel(screen.root, "Message composer")?.props.value).toBe(
		"Same-turn takeover",
	);
	screen.unmount();
});
it("never uploads an image removed in the same turn that durable consumption resolves", async () => {
	const consumption = Promise.withResolvers<void>();
	const sendInput = vi.fn(async () => {});
	const screen = render(
		<ChatScreen
			connection={fakeConnection({ sendInput })}
			initialMessage="Retain caption"
			initialAttachments={{ userImages: ["data:image/jpeg;base64,/9j/"] }}
			onInitialMessageConsumed={() => consumption.promise}
		/>,
	);
	await act(async () => {});
	await act(async () => {
		findByLabel(screen.root, "Remove Image 1")?.props.onPress();
		consumption.resolve();
		await Promise.resolve();
	});
	expect(sendInput).toHaveBeenCalledExactlyOnceWith("Retain caption");
	screen.unmount();
});

it("settles the saved model's unknown thinking capability when Chat's catalog check completes", () => {
	const connection = fakeConnection({ view: emptyView() });
	const onReasoningChange = vi.fn();
	const props = {
		connection,
		connectionKind: "cloud" as const,
		modelLabel: "saved/unknown-model",
		onReasoningChange,
	};
	const screen = render(<ChatScreen {...props} checkingImageSupport />);
	expect(containsText(screen.root, "Checking thinking…")).toBe(true);
	act(() =>
		screen.renderer.update(
			<ChatScreen {...props} checkingImageSupport={false} />,
		),
	);
	expect(containsText(screen.root, "Checking thinking…")).toBe(false);
	expect(containsText(screen.root, "Thinking options unavailable")).toBe(true);
	expect(
		containsText(screen.root, "Choose another model to configure thinking."),
	).toBe(true);
	expect(
		findByLabel(screen.root, "Thinking level: Model setting"),
	).toBeUndefined();
	expect(onReasoningChange).not.toHaveBeenCalled();
	act(() =>
		screen.renderer.update(
			<ChatScreen {...props} checkingImageSupport={false} supportsReasoning />,
		),
	);
	expect(
		findByLabel(screen.root, "Thinking level: Model setting"),
	).toBeDefined();
	expect(containsText(screen.root, "Thinking options unavailable")).toBe(false);
	act(() =>
		screen.renderer.update(
			<ChatScreen
				{...props}
				checkingImageSupport={false}
				supportsReasoning={false}
			/>,
		),
	);
	expect(containsText(screen.root, "Thinking unavailable")).toBe(true);
	expect(onReasoningChange).not.toHaveBeenCalled();
});

describe("approval UX", () => {
	it("shows waiting rather than running while a tool needs consent", () => {
		const connection = fakeConnection({
			view: {
				...emptyView(),
				connectionStatus: "live",
				runStatus: "running",
				pendingApprovals: [approval],
			},
		});
		const { root } = render(
			<ChatScreen connection={connection} connectionKind="cloud" />,
		);
		expect(containsText(root, "Waiting for approval")).toBe(true);
		expect(
			root.find((node) => node.type === ChatHeader).props.pendingApproval,
		).toBe(true);
	});
	it("keeps the exact action visible and hides envelope metadata until requested", () => {
		const connection = fakeConnection({
			view: {
				...emptyView(),
				pendingApprovals: [
					{
						...approval,
						inputJson: JSON.stringify({
							command: "git diff -- src/Example.tsx",
							cwd: "/workspace/project",
						}),
					},
				],
			},
		});
		const { root } = render(
			<ChatScreen connection={connection} connectionKind="cloud" />,
		);
		expect(containsText(root, "git diff -- src/Example.tsx")).toBe(true);
		expect(containsText(root, "/workspace/project")).toBe(true);
		expect(containsText(root, "Request ap1")).toBe(false);
		act(() =>
			findByLabel(root, "Approval request details, expand")!.props.onPress(),
		);
		expect(containsText(root, "Request ap1")).toBe(true);
	});
	it("keeps unrecognized command options visible before approval", () => {
		const connection = fakeConnection({
			view: {
				...emptyView(),
				pendingApprovals: [
					{
						...approval,
						inputJson: JSON.stringify({
							command: "run",
							privileged: true,
							target: "/workspace/private",
						}),
					},
				],
			},
		});
		const { root } = render(
			<ChatScreen connection={connection} connectionKind="cloud" />,
		);
		expect(containsText(root, "privileged")).toBe(true);
		expect(containsText(root, "/workspace/private")).toBe(true);
	});
});
