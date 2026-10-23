import { ActionSheetIOS } from "react-native";
import { act } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../../ui/__testing__/render";
import { ComposerAttachmentMenu } from "./ComposerAttachmentMenu";
import { appendTextFile } from "./TextFileAttachment";

const picker = vi.hoisted(() => ({
	pick: vi.fn(),
	read: vi.fn(),
	remove: vi.fn(),
}));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: picker.pick }));
vi.mock("expo-file-system", () => ({
	File: class {
		size = 5;
		text = picker.read;
		delete = picker.remove;
	},
}));

describe("text file contents", () => {
	beforeEach(() => vi.clearAllMocks());

	it("preserves content and rejects binary, invalid UTF-8, empty and oversized files", () => {
		expect(appendTextFile("Review this", "notes.txt", "Hello\nworld")).toBe(
			'Review this\n\nAttached file "notes.txt":\nHello\nworld',
		);
		for (const content of [
			"\0binary",
			"\uFFFD",
			" ",
			"x".repeat(128 * 1024 + 1),
		]) {
			expect(() => appendTextFile("", "file", content)).toThrow();
		}
	});

	it("appends to the latest draft after reading and removes only the cached copy", async () => {
		let resolve!: (text: string) => void;
		picker.pick.mockResolvedValue({
			canceled: false,
			assets: [{ uri: "file:///cache/copied.txt", name: "notes.txt" }],
		});
		picker.read.mockImplementation(
			() =>
				new Promise<string>((done) => {
					resolve = done;
				}),
		);
		const onChange = vi.fn();
		const screen = render(
			<ComposerAttachmentMenu
				draft="Before"
				onDraftChange={onChange}
				onPickImages={vi.fn()}
			/>,
		);
		await act(async () => {
			screen.root
				.findAll(
					(node) =>
						node.type === "Pressable" &&
						node.props.accessibilityLabel === "Add attachment",
				)[0]
				?.props.onPress();
			vi.mocked(ActionSheetIOS.showActionSheetWithOptions).mock.lastCall?.[1](
				1,
			);
		});
		act(() =>
			screen.renderer.update(
				<ComposerAttachmentMenu
					draft="Edited while reading"
					onDraftChange={onChange}
					onPickImages={vi.fn()}
				/>,
			),
		);
		await act(async () => {
			resolve("hello");
		});
		expect(onChange).toHaveBeenCalledWith(
			'Edited while reading\n\nAttached file "notes.txt":\nhello',
		);
		expect(picker.remove).toHaveBeenCalledOnce();
	});

	it("shows a readable file error without losing the draft and allows retry", async () => {
		picker.pick.mockResolvedValue({
			canceled: false,
			assets: [{ uri: "file:///cache/copied.txt", name: "notes.txt" }],
		});
		picker.read
			.mockRejectedValueOnce(
				new Error("UnexpectedException: native text decoding failed"),
			)
			.mockResolvedValueOnce("hello");
		const onChange = vi.fn();
		const onError = vi.fn();
		const screen = render(
			<ComposerAttachmentMenu
				draft="Keep this draft"
				onDraftChange={onChange}
				onPickImages={vi.fn()}
				onError={onError}
			/>,
		);
		const open = () => {
			screen.root
				.findAll(
					(node) =>
						node.type === "Pressable" &&
						node.props.accessibilityLabel === "Add attachment",
				)[0]
				?.props.onPress();
			vi.mocked(ActionSheetIOS.showActionSheetWithOptions).mock.lastCall?.[1](
				1,
			);
		};
		await act(async () => open());
		expect(onError).toHaveBeenLastCalledWith(
			"Couldn't read this file. Choose a UTF-8 text file and try again.",
		);
		expect(onChange).not.toHaveBeenCalled();
		expect(picker.remove).toHaveBeenCalledOnce();

		await act(async () => open());
		expect(onError).toHaveBeenLastCalledWith(undefined);
		expect(onChange).toHaveBeenCalledExactlyOnceWith(
			'Keep this draft\n\nAttached file "notes.txt":\nhello',
		);
		expect(picker.remove).toHaveBeenCalledTimes(2);
	});
});
