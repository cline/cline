import { useTheme } from "../hooks/use-theme";
import { getDialogAccents } from "../themes";
import type {
	DialogRecord,
	DialogSize,
	DialogStyle,
	DialogVariant,
} from "./types";

export const DIALOG_VARIANTS: readonly DialogVariant[] = [
	"pages",
	"frame",
	"edge",
	"topbar",
	"shadow",
	"classic",
];

export const DEFAULT_DIALOG_VARIANT: DialogVariant = "pages";

export function normalizeDialogVariant(
	value: string | undefined | null,
): DialogVariant | undefined {
	const trimmed = value?.trim().toLowerCase();
	return DIALOG_VARIANTS.find((variant) => variant === trimmed);
}

interface VariantChrome {
	/** Panel surface color (dialog surfaces are always dark, like content). */
	background: string;
	backdropColor: string;
	/** 0-1 alpha applied over the app behind the dialog. */
	backdropOpacity: number;
	defaultPadding: PaddingSides;
}

interface PaddingSides {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

const VARIANT_CHROME: Record<DialogVariant, VariantChrome> = {
	pages: {
		// Fallback page surface; dark themes reuse their own background so the
		// page reads as in-app navigation rather than an overlay.
		background: "#14161b",
		backdropColor: "#000000",
		backdropOpacity: 0, // pages are opaque full-screen takeovers
		defaultPadding: { top: 1, right: 1, bottom: 1, left: 1 },
	},
	frame: {
		background: "#1c1f27",
		backdropColor: "#000000",
		backdropOpacity: 0.4,
		defaultPadding: { top: 1, right: 1, bottom: 1, left: 1 },
	},
	edge: {
		background: "#20232b",
		backdropColor: "#000000",
		backdropOpacity: 0.45,
		defaultPadding: { top: 1, right: 1, bottom: 1, left: 2 },
	},
	topbar: {
		background: "#1f222a",
		backdropColor: "#000000",
		backdropOpacity: 0.4,
		defaultPadding: { top: 1, right: 1, bottom: 1, left: 1 },
	},
	shadow: {
		background: "#242833",
		backdropColor: "#000000",
		backdropOpacity: 0.3,
		defaultPadding: { top: 1, right: 1, bottom: 1, left: 1 },
	},
	classic: {
		background: "#262626",
		backdropColor: "#000000",
		backdropOpacity: 0.35,
		defaultPadding: { top: 1, right: 1, bottom: 1, left: 1 },
	},
};

export function getVariantChrome(variant: DialogVariant): VariantChrome {
	return VARIANT_CHROME[variant];
}

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

/**
 * Extra columns each variant's chrome consumes (borders, accent bars).
 * Dialog contents size themselves against the historical borderless panel
 * width, so the panel grows by this amount to keep the inner width the same.
 */
const VARIANT_WIDTH_OVERHEAD: Record<DialogVariant, number> = {
	pages: 0,
	frame: 2,
	edge: 1,
	topbar: 0,
	shadow: 2,
	classic: 0,
};

function resolvePadding(
	style: DialogStyle,
	defaults: PaddingSides,
): PaddingSides {
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
	variant: DialogVariant;
	defaultSize: DialogSize | undefined;
	terminalWidth: number;
	terminalHeight: number;
	/** 1-based position of this dialog in the stack (1 = opened first). */
	stackIndex: number;
	/** Number of dialogs currently open. */
	stackDepth: number;
}

/**
 * Renders one dialog's chrome around its content.
 *
 * For the "pages" variant each dialog is an opaque full-screen subpage with a
 * branded header; stacked dialogs are deeper pages and the top one covers the
 * rest. For the panel variants, dialogs are absolutely positioned inside the
 * centered dialog layer and overlap in the middle of the screen.
 */
export function DialogPanel(props: DialogPanelProps) {
	const {
		record,
		variant,
		defaultSize,
		terminalWidth,
		terminalHeight,
		stackIndex,
		stackDepth,
	} = props;
	const theme = useTheme();
	const accent = getDialogAccents(theme).act;
	const chrome = VARIANT_CHROME[variant];
	const style = record.style ?? {};
	const overhead = VARIANT_WIDTH_OVERHEAD[variant];
	// The drop shadow extends 2 columns past the panel, so leave room for it.
	const maxPanelWidth = terminalWidth - (variant === "shadow" ? 4 : 2);
	const width = Math.min(
		(style.width ?? resolveWidth(record.size, defaultSize, terminalWidth)) +
			overhead,
		maxPanelWidth,
	);
	const maxWidth = Math.min(
		(style.maxWidth ?? terminalWidth - 2) + overhead,
		maxPanelWidth,
	);
	const padding = resolvePadding(style, chrome.defaultPadding);
	const background = style.backgroundColor ?? chrome.background;

	if (variant === "pages") {
		// Full-screen subpage: branded header bar, heavy accent rule, and the
		// dialog content centered on an opaque page. Esc reads as "back".
		const pageBackground =
			style.backgroundColor ??
			(theme.variant === "dark" && theme.background
				? theme.background
				: chrome.background);
		// Header (1) + rule (1) + a row of breathing room above and below.
		const availableHeight = Math.max(terminalHeight - 4, 5);
		const maxHeight = Math.min(
			style.maxHeight ?? availableHeight,
			availableHeight,
		);
		return (
			<box
				position="absolute"
				left={0}
				top={0}
				width="100%"
				height="100%"
				flexDirection="column"
				backgroundColor={pageBackground}
			>
				<box
					flexDirection="row"
					justifyContent="space-between"
					height={1}
					flexShrink={0}
					paddingLeft={1}
					paddingRight={1}
				>
					<box flexDirection="row">
						<box backgroundColor={accent} paddingLeft={1} paddingRight={1}>
							<text fg="#000000">
								<strong>cline</strong>
							</text>
						</box>
					</box>
					<text fg="gray">
						{stackDepth > 1
							? `esc \u2039 back (${stackIndex}/${stackDepth})`
							: "esc \u2039 close"}
					</text>
				</box>
				<box
					height={1}
					flexShrink={0}
					border={["top"]}
					borderStyle="heavy"
					borderColor={accent}
				/>
				<box flexGrow={1} alignItems="center" justifyContent="center">
					<box
						flexDirection="column"
						width={width}
						maxWidth={maxWidth}
						minWidth={style.minWidth}
						maxHeight={maxHeight}
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

	if (variant === "edge") {
		// Borderless card with a solid accent bar down the left edge.
		return (
			<box
				position="absolute"
				flexDirection="row"
				width={width}
				maxWidth={maxWidth}
				minWidth={style.minWidth}
				maxHeight={style.maxHeight}
				backgroundColor={background}
			>
				<box width={1} flexShrink={0} backgroundColor={accent} />
				<box
					flexDirection="column"
					flexGrow={1}
					paddingTop={padding.top}
					paddingRight={padding.right}
					paddingBottom={padding.bottom}
					paddingLeft={padding.left}
				>
					{record.element}
				</box>
			</box>
		);
	}

	if (variant === "shadow") {
		// Sharp-cornered panel with a hard drop shadow (classic TUI style).
		return (
			<box position="absolute">
				<box
					position="absolute"
					left={2}
					top={1}
					width="100%"
					height="100%"
					backgroundColor="#000000"
					zIndex={0}
				/>
				<box
					flexDirection="column"
					width={width}
					maxWidth={maxWidth}
					minWidth={style.minWidth}
					maxHeight={style.maxHeight}
					backgroundColor={background}
					border
					borderStyle="single"
					borderColor="#5b6371"
					paddingTop={padding.top}
					paddingRight={padding.right}
					paddingBottom={padding.bottom}
					paddingLeft={padding.left}
					zIndex={1}
				>
					{record.element}
				</box>
			</box>
		);
	}

	if (variant === "frame") {
		// Rounded outline in a muted steel tone.
		return (
			<box
				position="absolute"
				flexDirection="column"
				width={width}
				maxWidth={maxWidth}
				minWidth={style.minWidth}
				maxHeight={style.maxHeight}
				backgroundColor={background}
				border
				borderStyle="rounded"
				borderColor="#4b5263"
				paddingTop={padding.top}
				paddingRight={padding.right}
				paddingBottom={padding.bottom}
				paddingLeft={padding.left}
			>
				{record.element}
			</box>
		);
	}

	if (variant === "topbar") {
		// Borderless panel crowned by a heavy accent rule along the top.
		return (
			<box
				position="absolute"
				flexDirection="column"
				width={width}
				maxWidth={maxWidth}
				minWidth={style.minWidth}
				maxHeight={style.maxHeight}
				backgroundColor={background}
				border={["top"]}
				borderStyle="heavy"
				borderColor={accent}
				paddingTop={padding.top}
				paddingRight={padding.right}
				paddingBottom={padding.bottom}
				paddingLeft={padding.left}
			>
				{record.element}
			</box>
		);
	}

	// "classic": the old borderless grey panel, kept for comparison.
	return (
		<box
			position="absolute"
			flexDirection="column"
			width={width}
			maxWidth={maxWidth}
			minWidth={style.minWidth}
			maxHeight={style.maxHeight}
			backgroundColor={background}
			paddingTop={padding.top}
			paddingRight={padding.right}
			paddingBottom={padding.bottom}
			paddingLeft={padding.left}
		>
			{record.element}
		</box>
	);
}
