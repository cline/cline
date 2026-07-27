// @jsxImportSource @opentui/react
import type {
	DialogId,
	DialogSize,
	DialogStyle,
} from "@opentui-ui/dialog/react";
import "opentui-spinner/react";
import {
	type LoadingDialogActions,
	withShownDialog,
} from "./loading-dialog-lifecycle";

export interface LoadingDialogContentProps {
	message: string;
}

export function LoadingDialogContent(props: LoadingDialogContentProps) {
	return (
		<box flexDirection="row" gap={1} paddingX={1}>
			<spinner name="dots" color="gray" />
			<text fg="gray">{props.message}</text>
		</box>
	);
}

export interface LoadingDialogOptions {
	size?: DialogSize;
	style?: DialogStyle;
}

export function showLoadingDialog(
	dialog: LoadingDialogActions,
	message: string,
	options?: LoadingDialogOptions,
): DialogId {
	return dialog.show({
		size: options?.size ?? "small",
		style: options?.style,
		closeOnEscape: false,
		closeOnClickOutside: false,
		content: () => <LoadingDialogContent message={message} />,
	});
}

export async function withLoadingDialog<T>(
	dialog: LoadingDialogActions,
	message: string,
	run: () => Promise<T>,
	options?: LoadingDialogOptions,
): Promise<T> {
	return await withShownDialog(
		dialog,
		() => showLoadingDialog(dialog, message, options),
		run,
	);
}
