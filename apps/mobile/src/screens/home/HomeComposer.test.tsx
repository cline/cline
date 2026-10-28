import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { ActionSheetIOS, Keyboard } from "react-native";
import { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "../../ui/__testing__/render";
import { containsText } from "../__testing__/harness";
import { HomeComposer } from "./HomeComposer";

afterEach(() => vi.restoreAllMocks());

describe("HomeComposer", () => {
	it("keeps model selection visible without discarding the draft", () => {
		const onOpenModel = vi.fn();
		const { root } = render(
			<HomeComposer
				draft="Keep this prompt"
				target={{
					id: "cloud",
					mode: "cloud",
					title: "team/repo",
					detail: "Cloud",
					cloud: {
						id: "cloud",
						mode: "cloud",
						label: "team/repo",
						repoUrl: "https://github.com/team/repo",
						modelId: "test-model",
					},
				}}
				modelName="Test model"
				onOpenModel={onOpenModel}
				onDraftChange={vi.fn()}
				onSend={vi.fn()}
			/>,
		);
		act(() =>
			root
				.find((node) => node.props.accessibilityLabel === "Model: Test model")
				.props.onPress(),
		);
		expect(onOpenModel).toHaveBeenLastCalledWith("models");
		expect(
			root.find(
				(node) => node.props.accessibilityLabel === "Message Cline from Home",
			).props.value,
		).toBe("Keep this prompt");
	});
	it.each([
		false,
		true,
	])("dismisses the keyboard only when a new prompt can send (busy=%s)", (busy) => {
		vi.spyOn(Keyboard, "dismiss").mockClear();
		const onSend = vi.fn();
		const { root } = render(
			<HomeComposer
				draft="Read this"
				busy={busy}
				target={{
					id: "local",
					mode: "local",
					title: "Mac",
					detail: "Computer",
					descriptor: { mode: "local", url: "ws://127.0.0.1:4599/hub" },
				}}
				onDraftChange={vi.fn()}
				onSend={onSend}
			/>,
		);
		act(() =>
			root
				.find((node) => node.props.accessibilityLabel === "Send to Mac")
				.props.onPress(),
		);
		expect(Keyboard.dismiss).toHaveBeenCalledTimes(busy ? 0 : 1);
		expect(onSend).toHaveBeenCalledTimes(busy ? 0 : 1);
		if (!busy)
			expect(
				vi.mocked(Keyboard.dismiss).mock.invocationCallOrder[0],
			).toBeLessThan(onSend.mock.invocationCallOrder[0]!);
	});
	it("retains images and text when the selected model cannot accept images", async () => {
		vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
			canceled: false,
			assets: [
				{
					assetId: null,
					base64: "/9j/",
					duration: null,
					exif: null,
					fileName: "image.jpg",
					fileSize: 3,
					height: 1,
					mimeType: "image/jpeg",
					type: "image",
					uri: "file:///image.jpg",
					width: 1,
				},
			],
		});
		const onSend = vi.fn();
		const onDraftChange = vi.fn();
		let changeModel!: (supported: boolean) => void;
		let finishChecking!: () => void;
		function Harness() {
			const [supportsImages, setSupportsImages] = useState(false);
			const [checking, setChecking] = useState(true);
			finishChecking = () => setChecking(false);
			changeModel = setSupportsImages;
			return (
				<HomeComposer
					draft="Describe this"
					supportsImages={supportsImages}
					checkingImageSupport={checking}
					target={{
						id: "local",
						mode: "local",
						title: "Mac",
						detail: "Computer",
						descriptor: {
							mode: "local",
							url: "ws://127.0.0.1:4599/hub",
							label: "Mac",
						},
					}}
					onDraftChange={onDraftChange}
					onSend={onSend}
				/>
			);
		}
		const { root } = render(<Harness />);
		await act(async () => {
			root
				.find((node) => node.props.accessibilityLabel === "Add attachment")
				.props.onPress();
			vi.mocked(ActionSheetIOS.showActionSheetWithOptions).mock.lastCall![1](0);
		});
		act(() =>
			root
				.find((node) => node.props.accessibilityLabel === "Send to Mac")
				.props.onPress(),
		);
		expect(onSend).not.toHaveBeenCalled();
		expect(onDraftChange).not.toHaveBeenCalled();
		expect(containsText(root, "Checking model image support…")).toBe(true);
		act(() => finishChecking());
		expect(
			containsText(
				root,
				"Choose a model that supports images or remove the attached images.",
			),
		).toBe(true);
		act(() => changeModel(true));
		expect(containsText(root, "Choose a model that supports images")).toBe(
			false,
		);
		act(() =>
			root
				.find((node) => node.props.accessibilityLabel === "Send to Mac")
				.props.onPress(),
		);
		expect(onSend).toHaveBeenCalledWith("Describe this", {
			userImages: ["data:image/jpeg;base64,/9j/"],
		});
	});
	it("asks for an instruction before starting with an image", async () => {
		vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
			canceled: false,
			assets: [
				{
					assetId: null,
					base64: "/9j/",
					duration: null,
					exif: null,
					fileName: "screenshot.jpg",
					fileSize: 3,
					height: 1,
					mimeType: "image/jpeg",
					type: "image",
					uri: "file:///screenshot.jpg",
					width: 1,
				},
			],
		});
		const onSend = vi.fn();
		const { root } = render(
			<HomeComposer
				draft=""
				target={{
					id: "local",
					mode: "local",
					title: "MacBook Pro",
					detail: "New Cline session on this computer",
					descriptor: {
						mode: "local",
						url: "ws://192.168.1.2:4599/hub",
						label: "MacBook Pro",
					},
				}}
				onDraftChange={() => {}}
				onSend={onSend}
			/>,
		);
		await act(async () => {
			root
				.find((node) => node.props.accessibilityLabel === "Add attachment")
				.props.onPress();
			vi.mocked(ActionSheetIOS.showActionSheetWithOptions).mock.lastCall![1](0);
		});
		const send = root.find(
			(node) => node.props.accessibilityLabel === "Send to MacBook Pro",
		);
		expect(send.props.accessibilityState?.disabled ?? send.props.disabled).toBe(
			false,
		);
		act(() => send.props.onPress());
		expect(onSend).not.toHaveBeenCalled();
		expect(
			containsText(
				root,
				"Add a message describing what you want Cline to do with the attached images.",
			),
		).toBe(true);
	});
});

it("keeps a saved model readable while its catalog entry is unavailable", () => {
	const modelId = "anthropic/claude-sonnet-4-6-mini";
	const screen = render(
		<HomeComposer
			cloud
			modelId={modelId}
			draft=""
			onDraftChange={vi.fn()}
			onSend={vi.fn()}
		/>,
	);
	expect(containsText(screen.root, "Claude Sonnet 4.6 Mini")).toBe(true);
	expect(containsText(screen.root, modelId)).toBe(false);
	screen.unmount();
});
