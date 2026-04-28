import type { KeyEvent, PasteEvent } from "@opentui/core";
import { useCallback, useRef } from "react";
import {
	readClipboardImageDataUrl,
	readImagePasteAttachment,
	readImmediateImagePasteAttachment,
} from "../utils/image-paste";

export interface TextareaHandle {
	plainText: string;
	onSubmit: (() => void) | null;
	setText(text: string): void;
	insertText(text: string): void;
	cursorOffset: number;
}

export interface InputBarProps {
	accent: string;
	placeholder: string;
	initialValue: string;
	inputKey: number;
	onSubmit: () => void;
	onContentChange: (text: string) => void;
	onImagePaste?: (dataUrl: string) => string;
	textareaRef?: React.MutableRefObject<TextareaHandle | null>;
}

export function InputBar(props: InputBarProps) {
	const {
		accent,
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

	const handlePaste = useCallback(
		(event: PasteEvent) => {
			if (!onImagePasteRef.current) return;

			const immediate = readImmediateImagePasteAttachment(event);
			if (immediate) {
				event.preventDefault();
				insertImageAttachment(immediate.dataUrl);
				return;
			}

			void readImagePasteAttachment(event).then((attachment) => {
				if (!attachment) return;
				event.preventDefault();
				insertImageAttachment(attachment.dataUrl);
			});
		},
		[insertImageAttachment],
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
		<box border borderStyle="rounded" borderColor={accent} paddingX={1}>
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
