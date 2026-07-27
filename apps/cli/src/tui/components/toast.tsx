import { useTerminalDimensions } from "@opentui/react";
import { palette } from "../palette";

export type ToastVariant = "info" | "success" | "error";

export type ToastState = {
	message: string;
	variant: ToastVariant;
};

const variantColor: Record<ToastVariant, string> = {
	info: palette.selection,
	success: palette.success,
	error: palette.error,
};

export function Toast(props: { toast: ToastState | null }) {
	const { width } = useTerminalDimensions();

	if (!props.toast) {
		return null;
	}

	const availableWidth = Math.max(1, width - 4);
	const maxWidth = Math.min(44, availableWidth);
	const right = width < 32 ? 0 : 2;
	const color = variantColor[props.toast.variant];

	return (
		<box
			position="absolute"
			zIndex={100}
			top={1}
			right={right}
			maxWidth={maxWidth}
			border
			borderStyle="rounded"
			borderColor={color}
			paddingX={1}
		>
			<text fg={color} wrapMode="word">
				{props.toast.message}
			</text>
		</box>
	);
}
