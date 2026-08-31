// @jsxImportSource @opentui/react
import { useDialogPalette } from "../../hooks/use-theme";

/**
 * Two-line dialog list row: selection marker + label, with an optional
 * description indented underneath so labels stay left-aligned. Shared by the
 * history export picker and the MCP server list.
 */
export function DialogOptionRow(props: {
	selected: boolean;
	label: string;
	/** Rendered on an indented second line when present. */
	description?: string;
	/** Label color when the row is not selected. */
	labelColor?: string;
	/** Description color when the row is not selected (defaults to gray). */
	descriptionColor?: string;
	/**
	 * Show the ❯ selection marker before the label (default). Lists whose
	 * labels carry their own leading glyph (e.g. the MCP status dot) disable
	 * it and rely on the selection highlight alone.
	 */
	showMarker?: boolean;
	onMouseDown?: () => void;
}) {
	const palette = useDialogPalette();
	const {
		selected,
		label,
		description,
		labelColor,
		descriptionColor,
		showMarker = true,
	} = props;
	return (
		<box
			flexDirection="column"
			paddingX={1}
			backgroundColor={selected ? palette.selection : undefined}
			onMouseDown={props.onMouseDown}
		>
			<text fg={selected ? palette.textOnSelection : labelColor}>
				{showMarker ? (selected ? "\u276f " : "  ") : ""}
				{label}
			</text>
			{description ? (
				<text
					fg={selected ? palette.textOnSelection : (descriptionColor ?? "gray")}
					paddingLeft={2}
				>
					{description}
				</text>
			) : null}
		</box>
	);
}
