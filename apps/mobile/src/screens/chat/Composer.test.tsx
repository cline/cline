/**
 * Regression cover for a bug that made the app unusable: the composer's
 * `TextInput` was rendered with `pointerEvents={focused ? "auto" : "none"}`.
 *
 * That deadlocks. A view with `pointerEvents: "none"` cannot become first
 * responder, and `focused` only flips inside `onFocus`. The composer now leaves
 * the native TextInput as the direct touch target instead of routing taps
 * through a wrapper and imperative focus call.
 *
 * Nothing asserted this, which is why it shipped. These tests pin the property
 * that actually matters — the input is interactive *before* it has focus.
 */

import * as ImagePicker from "expo-image-picker";
import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";
import { type ComponentProps, useState } from "react";
import {
	ActionSheetIOS,
	Keyboard,
	Pressable,
	ScrollView,
	Text,
} from "react-native";
import { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "../../ui/__testing__/render";
import { containsText } from "../__testing__/harness";
import { Composer, type ComposerProps } from "./Composer";
import { QueuedPrompts } from "./QueuedPrompts";

type Node = { props: Record<string, unknown> };

/** The composer's input, located the way the sibling tests locate nodes. */
function findInput(root: {
	findAll(predicate: (node: Node) => boolean): Node[];
}): Node {
	const [input] = root.findAll(
		(node) => node.props.accessibilityLabel === "Message composer",
	);
	if (!input) {
		throw new Error("composer input not found");
	}
	return input;
}

function renderComposer(overrides: Partial<ComposerProps> = {}) {
	return render(
		<Composer
			running={false}
			draft=""
			onDraftChange={vi.fn()}
			onSend={vi.fn()}
			onAbort={vi.fn()}
			{...overrides}
		/>,
	);
}

async function pickImages(root: {
	find(predicate: (node: Node) => boolean): Node;
}) {
	const onPress = root.find(
		(node) => node.props.accessibilityLabel === "Add attachment",
	).props.onPress as () => void;
	await act(async () => onPress());
	const onSelect = vi.mocked(ActionSheetIOS.showActionSheetWithOptions).mock
		.lastCall?.[1];
	if (!onSelect) throw new Error("attachment menu did not open");
	await act(async () => onSelect(0));
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.mocked(ActionSheetIOS.showActionSheetWithOptions).mockReset();
	vi.mocked(
		ExpoSpeechRecognitionModule.requestPermissionsAsync,
	).mockResolvedValue({
		granted: true,
		canAskAgain: true,
		status: "granted",
		expires: "never",
	} as Awaited<
		ReturnType<typeof ExpoSpeechRecognitionModule.requestPermissionsAsync>
	>);
});

describe("Composer", () => {
	it("keeps actions outside the short scroll viewport while queued messages remain editable", async () => {
		const onEdit = vi.fn();
		const onSteer = vi.fn();
		const onRemove = vi.fn();
		const onAbort = vi.fn();
		const onSend = vi.fn();
		const { root } = renderComposer({
			compact: true,
			maxHeight: 110,
			running: true,
			draft: "Keep this draft",
			onAbort,
			onSend,
			initialUserImages: ["data:image/jpeg;base64,/9j/"],
			usageTotal: {
				inputTokens: 100,
				outputTokens: 20,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0,
			},
			queued: (
				<QueuedPrompts
					prompts={[
						{
							id: "queued",
							prompt: "Next task",
							delivery: "queue",
							attachmentCount: 0,
						},
					]}
					running
					onEdit={onEdit}
					onSteer={onSteer}
					onRemove={onRemove}
				/>
			),
		});
		const scroll = root.find(
			(node) =>
				node.type === ScrollView &&
				node.findAll(
					(child) => child.props.accessibilityLabel === "Message composer",
				).length > 0,
		);
		expect(containsText(scroll, "Next task")).toBe(true);
		expect(containsText(scroll, "120 · $0.0000")).toBe(true);
		expect(
			scroll.findAll((node) => node.props.testID === "composer-toolbar"),
		).toHaveLength(0);
		const press = async (label: string) =>
			act(async () =>
				root
					.findAll((node) => node.props.accessibilityLabel === label)
					.at(-1)!
					.props.onPress(),
			);
		await press('Edit "Next task"');
		act(() =>
			root
				.findAll(
					(node) => node.props.accessibilityLabel === "Edit queued message",
				)
				.at(-1)!
				.props.onChangeText("Edited task"),
		);
		await press("Save message");
		expect(onEdit).toHaveBeenCalledWith("queued", "Edited task");
		await press('Send "Next task" now');
		expect(onSteer).toHaveBeenCalledWith("queued");
		await press('Remove "Next task" from the queue');
		expect(onRemove).toHaveBeenCalledWith("queued");
		expect(findInput(root).props.value).toBe("Keep this draft");
		await press("Abort");
		expect(onAbort).toHaveBeenCalledOnce();
		await press("Send");
		expect(onSend).toHaveBeenCalledWith("Keep this draft", {
			userImages: ["data:image/jpeg;base64,/9j/"],
		});
	});

	it("keeps the model control and draft available in the compact toolbar", () => {
		let setCompact!: (compact: boolean) => void;
		function Controls() {
			const [model, setModel] = useState("First model");
			return (
				<Pressable
					accessibilityLabel="Choose model"
					onPress={() => setModel("Second model")}
				>
					<Text>{model}</Text>
				</Pressable>
			);
		}
		function Harness() {
			const [compact, updateCompact] = useState(true);
			setCompact = updateCompact;
			const [draft, setDraft] = useState("Keep my draft");
			return (
				<Composer
					compact={compact}
					running={false}
					draft={draft}
					onDraftChange={setDraft}
					onSend={vi.fn()}
					onAbort={vi.fn()}
					initialUserImages={["data:image/jpeg;base64,/9j/"]}
					supportsImages={false}
					controls={<Controls />}
				/>
			);
		}
		const { root } = render(<Harness />);
		const leadingControls = () =>
			root.find((node) => node.props.testID === "composer-leading-controls");
		expect(leadingControls().props.style.display).not.toBe("none");
		expect(
			root.find((node) => node.props.accessibilityLabel === "Add attachment"),
		).toBeDefined();
		expect(containsText(root, "Choose a model that supports images")).toBe(
			true,
		);
		act(() =>
			root
				.find((node) => node.props.accessibilityLabel === "Choose model")
				.props.onPress(),
		);
		act(() => setCompact(false));
		expect(containsText(root, "Second model")).toBe(true);
		expect(findInput(root).props.value).toBe("Keep my draft");
		act(() => setCompact(true));
		expect(leadingControls().props.style.display).not.toBe("none");
		expect(containsText(root, "Second model")).toBe(true);
		expect(findInput(root).props.value).toBe("Keep my draft");
		expect(containsText(root, "Choose a model that supports images")).toBe(
			true,
		);
	});

	it("places one quiet toolbar below the full-width input", () => {
		const { root } = renderComposer({ controls: <Text>Short model</Text> });
		const input = findInput(root);
		const leading = root.find(
			(node) => node.props.testID === "composer-leading-controls",
		);
		expect(input.props.value).toBe("");
		expect(input.props.style).toMatchObject({ width: "100%" });
		expect(containsText(leading, "Short model")).toBe(true);
		expect(
			root.findAll(
				(node) => node.props.accessibilityLabel === "Composer options",
			),
		).toHaveLength(0);
	});

	it("waits for image capability without clearing an editable draft", async () => {
		const onSend = vi.fn();
		const onDraftChange = vi.fn();
		const { root } = renderComposer({
			draft: "Review this",
			checkingImageSupport: true,
			initialUserImages: ["data:image/jpeg;base64,/9j/"],
			onSend,
			onDraftChange,
		});
		await act(async () =>
			root
				.find((node) => node.props.accessibilityLabel === "Send")
				.props.onPress(),
		);
		expect(onSend).not.toHaveBeenCalled();
		expect(onDraftChange).not.toHaveBeenCalled();
		expect(containsText(root, "Checking model image support…")).toBe(true);
	});
	it.each([
		true,
		false,
		undefined,
	])("checks declared image support (%s) without losing an unsupported draft", async (supportsImages) => {
		const onSend = vi.fn();
		const onDraftChange = vi.fn();
		const onUserImagesChange = vi.fn();
		const { root } = renderComposer({
			draft: "Review this",
			supportsImages,
			initialUserImages: ["data:image/jpeg;base64,/9j/"],
			onSend,
			onDraftChange,
			onUserImagesChange,
		});
		await act(async () =>
			root
				.find((node) => node.props.accessibilityLabel === "Send")
				.props.onPress(),
		);
		if (supportsImages === false) {
			expect(onSend).not.toHaveBeenCalled();
			expect(onDraftChange).not.toHaveBeenCalled();
			expect(onUserImagesChange).not.toHaveBeenCalledWith([]);
			expect(
				containsText(
					root,
					"Choose a model that supports images or remove the attached images.",
				),
			).toBe(true);
		} else {
			expect(onSend).toHaveBeenCalledWith("Review this", {
				userImages: ["data:image/jpeg;base64,/9j/"],
			});
		}
	});

	it("rechecks image support when the model changes and retains the attachment", async () => {
		const onSend = vi.fn();
		let setSupportsImages!: (value: boolean) => void;
		function Harness() {
			const [supportsImages, setSupport] = useState(false);
			setSupportsImages = setSupport;
			return (
				<Composer
					running={false}
					draft="Review this"
					supportsImages={supportsImages}
					initialUserImages={["data:image/jpeg;base64,/9j/"]}
					onDraftChange={() => {}}
					onSend={onSend}
					onAbort={() => {}}
				/>
			);
		}
		const { root } = render(<Harness />);
		await act(async () =>
			root
				.find((node) => node.props.accessibilityLabel === "Send")
				.props.onPress(),
		);
		expect(onSend).not.toHaveBeenCalled();
		act(() => setSupportsImages(true));
		expect(containsText(root, "Choose a model that supports images")).toBe(
			false,
		);
		await act(async () =>
			root
				.find((node) => node.props.accessibilityLabel === "Send")
				.props.onPress(),
		);
		expect(onSend).toHaveBeenCalledWith("Review this", {
			userImages: ["data:image/jpeg;base64,/9j/"],
		});
	});
	it("leaves the input interactive before it is focused", () => {
		const { root } = renderComposer();
		const input = findInput(root);
		// The whole bug in one assertion: unfocused must not mean untouchable.
		expect(input.props.pointerEvents).not.toBe("none");
	});

	it("keeps the input editable so it can accept typing", () => {
		const { root } = renderComposer();
		expect(findInput(root).props.editable).not.toBe(false);
	});

	it("reports typed text through onDraftChange", () => {
		const onDraftChange = vi.fn();
		const { root } = renderComposer({ onDraftChange });
		(findInput(root).props.onChangeText as (t: string) => void)("hello");
		expect(onDraftChange).toHaveBeenCalledWith("hello");
	});

	it("keeps rejected submissions on their retryable bubble, not in the composer", async () => {
		function Harness() {
			const [draft, setDraft] = useState("keep me");
			return (
				<Composer
					running={false}
					draft={draft}
					onDraftChange={setDraft}
					onSend={() => Promise.reject(new Error("offline"))}
					onAbort={() => {}}
				/>
			);
		}
		const { root } = render(<Harness />);
		const send = root.find((node) => node.props.accessibilityLabel === "Send");
		await act(async () => send.props.onPress());
		expect(findInput(root).props.value).toBe("");
	});

	it("clears accepted text immediately and refuses a duplicate tap", async () => {
		vi.spyOn(Keyboard, "dismiss").mockClear();
		let finish!: () => void;
		const onSend = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		function Harness() {
			const [draft, setDraft] = useState("send once");
			return (
				<Composer
					running={false}
					draft={draft}
					onDraftChange={setDraft}
					onSend={onSend}
					onAbort={() => {}}
				/>
			);
		}
		const { root } = render(<Harness />);
		const send = root.find((node) => node.props.accessibilityLabel === "Send");
		act(() => {
			send.props.onPress();
			send.props.onPress();
		});
		expect(onSend).toHaveBeenCalledTimes(1);
		expect(Keyboard.dismiss).toHaveBeenCalledTimes(1);
		expect(
			vi.mocked(Keyboard.dismiss).mock.invocationCallOrder[0],
		).toBeLessThan(onSend.mock.invocationCallOrder[0]!);
		expect(findInput(root).props.value).toBe("");
		await act(async () => finish());
	});
	it("does not dismiss the keyboard when a submission is blocked", () => {
		vi.spyOn(Keyboard, "dismiss").mockClear();
		const onSend = vi.fn();
		const { root } = renderComposer({
			draft: "keep typing",
			sendDisabled: true,
			onSend,
		});
		act(() =>
			root
				.find((node) => node.props.accessibilityLabel === "Send")
				.props.onPress(),
		);
		expect(onSend).not.toHaveBeenCalled();
		expect(Keyboard.dismiss).not.toHaveBeenCalled();
	});

	it("asks for an instruction before sending an image", async () => {
		vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
			canceled: false,
			assets: [
				{
					assetId: null,
					base64: "/9j/",
					duration: null,
					exif: null,
					fileName: "photo.jpg",
					fileSize: 3,
					height: 1,
					mimeType: "image/jpeg",
					type: "image",
					uri: "file:///photo.jpg",
					width: 1,
				},
			],
		});
		const onSend = vi.fn(async () => {});
		const { root, renderer } = renderComposer({ onSend });
		await pickImages(root);
		const send = root.find((node) => node.props.accessibilityLabel === "Send");
		expect(send.props.disabled).toBe(true);
		expect(
			containsText(
				root,
				"Add a message describing what you want Cline to do with the attached images.",
			),
		).toBe(true);
		const originalProps = root.find((node) => node.type === Composer)
			.props as ComponentProps<typeof Composer>;
		act(() =>
			renderer.update(
				<Composer {...originalProps} draft="Describe this photo" />,
			),
		);
		expect(
			root.find((node) => node.props.accessibilityLabel === "Send").props
				.disabled,
		).toBe(false);
		expect(
			containsText(
				root,
				"Add a message describing what you want Cline to do with the attached images.",
			),
		).toBe(false);
		act(() => renderer.update(<Composer {...originalProps} draft="   " />));
		expect(
			root.find((node) => node.props.accessibilityLabel === "Send").props
				.disabled,
		).toBe(true);

		await act(async () => send.props.onPress());
		expect(onSend).not.toHaveBeenCalled();
		expect(
			containsText(
				root,
				"Add a message describing what you want Cline to do with the attached images.",
			),
		).toBe(true);
	});

	it("does not duplicate an image echoed through controlled staged state", async () => {
		vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
			canceled: false,
			assets: [
				{
					assetId: null,
					base64: "/9j/",
					duration: null,
					exif: null,
					fileName: "photo.jpg",
					fileSize: 3,
					height: 1,
					mimeType: "image/jpeg",
					type: "image",
					uri: "file:///photo.jpg",
					width: 1,
				},
			],
		});
		const onSend = vi.fn(async () => {});
		function Harness() {
			const [userImages, setUserImages] = useState<string[]>([]);
			return (
				<Composer
					running={false}
					draft="Review this image"
					initialUserImages={userImages}
					onUserImagesChange={setUserImages}
					onDraftChange={() => {}}
					onSend={onSend}
					onAbort={() => {}}
				/>
			);
		}
		const { root } = render(<Harness />);
		await pickImages(root);
		expect(
			root.findAll(
				(node) =>
					typeof node.type === "string" &&
					node.type === "Image" &&
					node.props.accessibilityLabel === "photo.jpg",
			),
		).toHaveLength(1);
		await act(async () => {
			root
				.find((node) => node.props.accessibilityLabel === "Send")
				.props.onPress();
		});
		expect(onSend).toHaveBeenCalledWith("Review this image", {
			userImages: ["data:image/jpeg;base64,/9j/"],
		});
	});

	it("shows an actionable permission error after a voice request is denied", async () => {
		vi.mocked(
			ExpoSpeechRecognitionModule.requestPermissionsAsync,
		).mockResolvedValueOnce({
			granted: false,
			canAskAgain: false,
			status: "denied",
			expires: "never",
		} as Awaited<
			ReturnType<typeof ExpoSpeechRecognitionModule.requestPermissionsAsync>
		>);
		const { root } = renderComposer();
		const voice = root.find(
			(node) => node.props.accessibilityLabel === "Start voice input",
		);
		await act(async () => {
			voice.props.onPress();
			await Promise.resolve();
		});
		expect(
			containsText(
				root,
				"Enable microphone and speech recognition access in Settings.",
			),
		).toBe(true);
	});
});
