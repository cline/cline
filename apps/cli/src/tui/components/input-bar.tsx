import {
	decodePasteBytes,
	type KeyEvent,
	MouseButton,
	type MouseEvent,
	type PasteEvent,
	stripAnsiSequences,
	type TextareaRenderable,
} from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useCallback, useRef } from "react";
import { readTextFromSystemClipboard } from "../utils/clipboard";
import {
	readClipboardImageDataUrl,
	readImagePasteAttachment,
	readImmediateImagePasteAttachment,
} from "../utils/image-paste";
import { shouldCompactPastedText } from "../utils/pasted-snippets";

export type TextareaHandle = Pick<
	TextareaRenderable,
	| "plainText"
	| "onSubmit"
	| "focus"
	| "setText"
	| "insertText"
	| "cursorOffset"
	| "visualCursor"
	| "height"
	| "virtualLineCount"
	| "extmarks"
	| "getSelection"
>;

export interface InputBarProps {
	accent: string;
	ruleColor: string;
	inputForeground: string;
	inputPlaceholder: string;
	placeholder: string;
	initialValue: string;
	inputKey: number;
	onSubmit: () => void;
	onContentChange: (text: string) => void;
	onImagePaste?: (dataUrl: string) => string;
	onLargeTextPaste?: (text: string) => string;
	onVisualCursorChange?: (cursor: {
		visualCol: number;
		visualRow: number;
	}) => void;
	onFocusRequest?: () => void;
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
		ruleColor,
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
	const onVisualCursorChangeRef = useRef(props.onVisualCursorChange);
	onVisualCursorChangeRef.current = props.onVisualCursorChange;

	const emitVisualCursorChange = useCallback(() => {
		const cursor = inputRef.current?.visualCursor;
		if (!cursor) return;
		onVisualCursorChangeRef.current?.({
			visualCol: cursor.visualCol,
			visualRow: cursor.visualRow,
		});
	}, [inputRef]);

	const textareaRefCallback = useCallback(
		(node: unknown) => {
			const ta = node as TextareaHandle | null;
			inputRef.current = ta;
			if (ta) {
				ta.onSubmit = () => {
					onSubmitRef.current();
				};
				emitVisualCursorChange();
			}
		},
		[emitVisualCursorChange, inputRef],
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

	const isPastingRef = useRef(false);
	const pasteFromClipboard = useCallback(async () => {
		if (isPastingRef.current) return;
		isPastingRef.current = true;
		try {
			props.onFocusRequest?.();
			inputRef.current?.focus();

			if (onImagePasteRef.current) {
				const dataUrl = await readClipboardImageDataUrl();
				if (dataUrl) {
					insertImageAttachment(dataUrl);
					return;
				}
			}

			const text = await readTextFromSystemClipboard();
			if (!text) return;

			if (shouldCompactPastedText(text) && onLargeTextPasteRef.current) {
				const marker = onLargeTextPasteRef.current(text);
				insertAtomicText(marker);
				return;
			}

			const ta = inputRef.current;
			if (!ta) return;
			ta.insertText(text);
			queueMicrotask(() => {
				const plainText = inputRef.current?.plainText ?? "";
				onContentChangeRef.current(plainText);
				emitVisualCursorChange();
			});
		} finally {
			setTimeout(() => {
				isPastingRef.current = false;
			}, 100);
		}
	}, [
		emitVisualCursorChange,
		inputRef,
		insertAtomicText,
		insertImageAttachment,
		props.onFocusRequest,
	]);

	useKeyboard((key) => {
		if (
			key.ctrl &&
			(key.name === "v" || key.name === "V" || key.sequence === "\x16")
		) {
			void pasteFromClipboard();
		}
	});

	const handleKeyDown = useCallback(
		(event: KeyEvent) => {
			if (
				event.ctrl &&
				(event.name === "v" || event.name === "V" || event.sequence === "\x16")
			) {
				event.preventDefault();
				void pasteFromClipboard();
				return;
			}
		},
		[pasteFromClipboard],
	);

	const handleMouseDown = useCallback(
		(event: MouseEvent) => {
			props.onFocusRequest?.();
			inputRef.current?.focus();
			if (
				event.button === MouseButton.RIGHT ||
				event.button === MouseButton.MIDDLE
			) {
				event.preventDefault();
				event.stopPropagation();
				void pasteFromClipboard();
			}
		},
		[inputRef, pasteFromClipboard, props.onFocusRequest],
	);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI boxes handle terminal mouse input.
		<box
			flexDirection="row"
			alignItems="flex-start"
			border={["top", "bottom"]}
			borderStyle="single"
			borderColor={ruleColor}
			onMouseDown={handleMouseDown}
		>
			<text fg={accent}>
				<strong>{"❯"}</strong>
			</text>
			<box flexGrow={1} paddingLeft={1}>
				<textarea
					key={inputKey}
					ref={textareaRefCallback as React.RefCallback<never>}
					initialValue={initialValue}
					onMouseDown={handleMouseDown}
					onContentChange={() => {
						queueMicrotask(() => {
							const text = inputRef.current?.plainText ?? "";
							onContentChangeRef.current(text);
							emitVisualCursorChange();
						});
					}}
					onPaste={handlePaste}
					onKeyDown={(event: KeyEvent) => {
						handleKeyDown(event);
						queueMicrotask(() => {
							emitVisualCursorChange();
						});
					}}
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
		</box>
	);
}
