import { useTheme } from "../hooks/use-theme";
import { getDialogAccents } from "../themes";
import type { DialogRecord, DialogSize, DialogStyle } from "./types";

/** Sheet surface color (dialog surfaces are always dark, like content). */
const SHEET_BACKGROUND = "#181b22";

export const BACKDROP_COLOR = "#000000";
/** Light dim so the conversation stays readable behind the sheet. */
export const BACKDROP_OPACITY = 0.25;

/**
 * Lower-half block: renders the accent edge in the bottom half of the row
 * while the top half stays transparent, so the sheet's edge line sits flush
 * against the top of the sheet with no background leaking above it.
 */
const SHEET_EDGE_CHAR = "\u2584";

const SIZE_WIDTHS: Record<DialogSize, number> = {
	small: 40,
	medium: 60,
	large: 80,
	full: -1,
};

function resolveWidth(
	size: DialogSize | undefined,
	defaultSize: DialogSize | undefined,
	terminalWidth: number,
): number {
	const preset = SIZE_WIDTHS[size ?? defaultSize ?? "medium"];
	return preset === -1 ? Math.max(terminalWidth - 4, 20) : preset;
}

interface PaddingSides {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

const DEFAULT_PADDING: PaddingSides = { top: 1, right: 1, bottom: 1, left: 1 };

function resolvePadding(style: DialogStyle): PaddingSides {
	const defaults = DEFAULT_PADDING;
	return {
		top: style.paddingTop ?? style.paddingY ?? style.padding ?? defaults.top,
		right:
			style.paddingRight ?? style.paddingX ?? style.padding ?? defaults.right,
		bottom:
			style.paddingBottom ?? style.paddingY ?? style.padding ?? defaults.bottom,
		left: style.paddingLeft ?? style.paddingX ?? style.padding ?? defaults.left,
	};
}

export interface DialogPanelProps {
	record: DialogRecord;
	defaultSize: DialogSize | undefined;
	terminalWidth: number;
	terminalHeight: number;
}

/**
 * Renders one dialog as a bottom sheet: a full-width panel docked to the
 * bottom edge under a heavy accent line, with the dialog content centered
 * horizontally inside it. The conversation stays visible above the sheet.
 * Stacked dialogs render in order, so the newest sheet covers the others.
 */
export function DialogPanel(props: DialogPanelProps) {
	const { record, defaultSize, terminalWidth, terminalHeight } = props;
	const theme = useTheme();
	const accent = getDialogAccents(theme).act;
	const style = record.style ?? {};
	const width = Math.min(
		style.width ?? resolveWidth(record.size, defaultSize, terminalWidth),
		terminalWidth - 2,
	);
	const maxWidth = Math.min(
		style.maxWidth ?? terminalWidth - 2,
		terminalWidth - 2,
	);
	const padding = resolvePadding(style);
	const background = style.backgroundColor ?? SHEET_BACKGROUND;
	// One row belongs to the accent edge line.
	const maxHeight = Math.min(
		style.maxHeight ?? terminalHeight - 4,
		terminalHeight - 2,
	);

	return (
		<box
			position="absolute"
			left={0}
			bottom={0}
			width="100%"
			maxHeight={maxHeight}
			flexDirection="column"
		>
			<text fg={accent} height={1}>
				{SHEET_EDGE_CHAR.repeat(terminalWidth)}
			</text>
			<box
				width="100%"
				flexDirection="column"
				alignItems="center"
				backgroundColor={background}
				maxHeight={maxHeight - 1}
			>
				<box
					flexDirection="column"
					width={width}
					maxWidth={maxWidth}
					minWidth={style.minWidth}
					maxHeight={maxHeight - 1}
					paddingTop={padding.top}
					paddingRight={padding.right}
					paddingBottom={padding.bottom}
					paddingLeft={padding.left}
				>
					{record.element}
				</box>
			</box>
		</box>
	);
}
