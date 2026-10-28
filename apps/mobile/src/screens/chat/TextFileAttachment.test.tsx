import { ActionSheetIOS } from "react-native";
import { act } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../../ui/__testing__/render";
import { ComposerAttachmentMenu } from "./ComposerAttachmentMenu";
import { appendTextFile, decodeTextFile } from "./TextFileAttachment";

const picker = vi.hoisted(() => ({
	pick: vi.fn(),
	read: vi.fn(),
	readText: vi.fn(() => "native-decoder-truncated-prefix"),
	remove: vi.fn(),
}));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: picker.pick }));
vi.mock("expo-file-system", () => ({
	File: class {
		size = 5;
		bytes = picker.read;
		text = picker.readText;
		delete = picker.remove;
	},
}));

describe("text file contents", () => {
	beforeEach(() => vi.clearAllMocks());

	it("preserves content and rejects binary, empty and oversized files", () => {
		expect(appendTextFile("Review this", "notes.txt", "Hello\nworld")).toBe(
			'Review this\n\nAttached file "notes.txt":\nHello\nworld',
		);
		for (const content of ["\0binary", " ", "x".repeat(128 * 1024 + 1)]) {
			expect(() => appendTextFile("", "file", content)).toThrow();
		}
	});

	it("preserves an authored replacement character encoded as valid UTF-8", () => {
		const bytes = Uint8Array.from([0x41, 0xef, 0xbf, 0xbd, 0x42]);
		expect(appendTextFile("", "literal.txt", decodeTextFile(bytes))).toBe(
			'Attached file "literal.txt":\nA\uFFFDB',
		);
	});

	it("decodes complete UTF-8 bytes and rejects NUL, malformed and oversized data", () => {
		const text =
			"café 🧪\nAuthored literal: \uFFFD\nRemaining text after a multibyte character";
		expect(decodeTextFile(new TextEncoder().encode(text))).toBe(text);
		for (const bytes of [
			[0x61, 0, 0x62],
			[0xff],
			[0xc3, 0x28],
			[0xe2, 0x82],
			[0xc0, 0xaf],
			[0xed, 0xa0, 0x80],
			[0xf4, 0x90, 0x80, 0x80],
		]) {
			expect(() => decodeTextFile(Uint8Array.from(bytes))).toThrow(
				"Choose a UTF-8 text file.",
			);
		}
		expect(() => decodeTextFile(new Uint8Array(128 * 1024 + 1))).toThrow(
			"Choose a text file smaller than 128 KB.",
		);
	});

	it("rejects original binary bytes without consulting the lossy native text reader and allows UTF-8 retry", async () => {
		picker.pick.mockResolvedValue({
			canceled: false,
			assets: [{ uri: "file:///cache/copied.txt", name: "notes.txt" }],
		});
		picker.read
			.mockResolvedValueOnce(Uint8Array.from([0x61, 0, 0xff]))
			.mockResolvedValueOnce(
				new TextEncoder().encode("café 🧪\nLiteral: \uFFFD\nEnd"),
			);
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
		expect(onError).toHaveBeenLastCalledWith("Choose a UTF-8 text file.");
		expect(onChange).not.toHaveBeenCalled();
		expect(picker.readText).not.toHaveBeenCalled();
		expect(picker.remove).toHaveBeenCalledOnce();
		await act(async () => open());
		expect(onChange).toHaveBeenCalledExactlyOnceWith(
			'Keep this draft\n\nAttached file "notes.txt":\ncafé 🧪\nLiteral: \uFFFD\nEnd',
		);
		expect(picker.remove).toHaveBeenCalledTimes(2);
	});

	it("appends to the latest draft after reading and removes only the cached copy", async () => {
		let resolve!: (bytes: Uint8Array) => void;
		picker.pick.mockResolvedValue({
			canceled: false,
			assets: [{ uri: "file:///cache/copied.txt", name: "notes.txt" }],
		});
		picker.read.mockImplementation(
			() =>
				new Promise<Uint8Array>((done) => {
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
			resolve(new TextEncoder().encode("hello"));
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
			.mockResolvedValueOnce(new TextEncoder().encode("hello"));
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
