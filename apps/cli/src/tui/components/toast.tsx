import { useTerminalDimensions } from "@opentui/react";
import { useTheme } from "../hooks/use-theme";

export type ToastVariant = "info" | "success" | "error";

export type ToastState = {
	message: string;
	variant: ToastVariant;
};

export function Toast(props: { toast: ToastState | null }) {
	const { width } = useTerminalDimensions();
	const theme = useTheme();

	if (!props.toast) {
		return null;
	}

	const variantColor: Record<ToastVariant, string> = {
		info: theme.accents.act,
		success: theme.accents.success,
		error: theme.accents.error,
	};
	const availableWidth = Math.max(1, width - 4);
	const maxWidth = Math.min(44, availableWidth);
	// Border and horizontal padding take four columns. An explicit width (not
	// maxWidth) is what makes the text wrap instead of clipping at the edge.
	const boxWidth = Math.min(maxWidth, props.toast.message.length + 4);
	const right = width < 32 ? 0 : 2;
	const color = variantColor[props.toast.variant];

	return (
		<box
			position="absolute"
			zIndex={100}
			top={1}
			right={right}
			width={boxWidth}
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
