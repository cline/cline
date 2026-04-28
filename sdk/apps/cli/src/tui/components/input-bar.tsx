import {
	decodePasteBytes,
	type ExtmarksController,
	type KeyEvent,
	type PasteEvent,
	stripAnsiSequences,
} from "@opentui/core";
import { useCallback, useRef } from "react";
import {
	readClipboardImageDataUrl,
	readImagePasteAttachment,
	readImmediateImagePasteAttachment,
} from "../utils/image-paste";
import { shouldCompactPastedText } from "../utils/pasted-snippets";

export interface TextareaHandle {
	plainText: string;
	onSubmit: (() => void) | null;
	setText(text: string): void;
	insertText(text: string): void;
	cursorOffset: number;
	extmarks: ExtmarksController;
	getSelection(): { start: number; end: number } | null;
}

export interface InputBarProps {
	accent: string;
	inputBackground: string;
	inputForeground: string;
	inputPlaceholder: string;
	placeholder: string;
	initialValue: string;
	inputKey: number;
	onSubmit: () => void;
	onContentChange: (text: string) => void;
	onImagePaste?: (dataUrl: string) => string;
	onLargeTextPaste?: (text: string) => string;
	textareaRef?: React.MutableRefObject<TextareaHandle | null>;
}

function readTextPaste(event: PasteEvent): string | null {
	if (
		event.metadata?.kind === "binary" ||
		event.metadata?.mimeType?.startsWith("image/")
	) {
		return null;
	}

	return stripAnsiSequences(decodePasteBytes(event.bytes));
}

export function InputBar(props: InputBarProps) {
	const {
		accent,
		inputBackground,
		inputForeground,
		inputPlaceholder,
		placeholder,
		initialValue,
		inputKey,
		onSubmit,
		onContentChange,
	} = props;
	const localRef = useRef<TextareaHandle | null>(null);
	const inputRef = props.textareaRef ?? localRef;

	const onSubmitRef = useRef(onSubmit);
	onSubmitRef.current = onSubmit;
	const onContentChangeRef = useRef(onContentChange);
	onContentChangeRef.current = onContentChange;
	const onImagePasteRef = useRef(props.onImagePaste);
	onImagePasteRef.current = props.onImagePaste;
	const onLargeTextPasteRef = useRef(props.onLargeTextPaste);
	onLargeTextPasteRef.current = props.onLargeTextPaste;

	const textareaRefCallback = useCallback(
		(node: unknown) => {
			const ta = node as TextareaHandle | null;
			inputRef.current = ta;
			if (ta) {
				ta.onSubmit = () => {
					onSubmitRef.current();
				};
			}
		},
		[inputRef],
	);

	const insertImageAttachment = useCallback(
		(dataUrl: string) => {
			const marker = onImagePasteRef.current?.(dataUrl);
			if (!marker) return;
			inputRef.current?.insertText(`${marker} `);
			queueMicrotask(() => {
				const text = inputRef.current?.plainText ?? "";
				onContentChangeRef.current(text);
			});
		},
		[inputRef],
	);

	const insertAtomicText = useCallback(
		(text: string) => {
			const ta = inputRef.current;
			if (!ta) return;

			const selection = ta.getSelection();
			const start = selection
				? Math.min(selection.start, selection.end)
				: ta.cursorOffset;
			ta.insertText(text);
			ta.extmarks.create({
				start,
				end: start + text.length,
				virtual: true,
			});
			queueMicrotask(() => {
				const plainText = inputRef.current?.plainText ?? "";
				onContentChangeRef.current(plainText);
			});
		},
		[inputRef],
	);

	const handlePaste = useCallback(
		(event: PasteEvent) => {
			if (onImagePasteRef.current) {
				const immediate = readImmediateImagePasteAttachment(event);
				if (immediate) {
					event.preventDefault();
					insertImageAttachment(immediate.dataUrl);
					return;
				}
			}

			const pastedText = readTextPaste(event);
			if (
				pastedText &&
				shouldCompactPastedText(pastedText) &&
				onLargeTextPasteRef.current
			) {
				const marker = onLargeTextPasteRef.current(pastedText);
				event.preventDefault();
				insertAtomicText(marker);
				return;
			}

			if (onImagePasteRef.current) {
				void readImagePasteAttachment(event).then((attachment) => {
					if (!attachment) return;
					event.preventDefault();
					insertImageAttachment(attachment.dataUrl);
				});
			}
		},
		[insertAtomicText, insertImageAttachment],
	);

	const handleKeyDown = useCallback(
		(event: KeyEvent) => {
			if (!event.ctrl || event.name !== "v" || !onImagePasteRef.current) {
				return;
			}

			void readClipboardImageDataUrl().then((dataUrl) => {
				if (!dataUrl) return;
				event.preventDefault();
				insertImageAttachment(dataUrl);
			});
		},
		[insertImageAttachment],
	);

	return (
		<box
			flexDirection="row"
			gap={1}
			alignItems="flex-start"
			backgroundColor={inputBackground}
			paddingX={2}
			paddingY={1}
		>
			<text fg={accent}>
				<strong>{">"}</strong>
			</text>
			<textarea
				key={inputKey}
				ref={textareaRefCallback as React.RefCallback<never>}
				initialValue={initialValue}
				onContentChange={() => {
					queueMicrotask(() => {
						const text = inputRef.current?.plainText ?? "";
						onContentChangeRef.current(text);
					});
				}}
				onPaste={handlePaste}
				onKeyDown={handleKeyDown}
				placeholder={placeholder}
				placeholderColor={inputPlaceholder}
				textColor={inputForeground}
				focusedTextColor={inputForeground}
				focused
				flexGrow={1}
				cursorColor={accent}
				minHeight={1}
				maxHeight={5}
				wrapMode="word"
				keyBindings={[
					{ name: "return", action: "submit" },
					{ name: "return", shift: true, action: "newline" },
					{ name: "return", ctrl: true, action: "newline" },
					{ name: "return", meta: true, action: "newline" },
				]}
			/>
		</box>
	);
}
