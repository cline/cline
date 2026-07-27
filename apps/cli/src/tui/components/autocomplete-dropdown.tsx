import { useTerminalDimensions } from "@opentui/react";
import type {
	AutocompleteMode,
	AutocompleteOption,
} from "../hooks/use-autocomplete";
import { useTerminalBackground } from "../hooks/use-terminal-background";
import { getDefaultForeground, palette } from "../palette";

const MAX_ROWS = 7;
export const DROPDOWN_MAX_HEIGHT = MAX_ROWS + 2;

export interface AutocompleteDropdownProps {
	mode: AutocompleteMode;
	options: AutocompleteOption[];
	selected: number;
	onSelect: (option: AutocompleteOption) => void;
	accent?: string;
	containerWidth?: number;
}

export function AutocompleteDropdown(props: AutocompleteDropdownProps) {
	const { mode, options, selected, onSelect, accent = palette.act } = props;
	const { width: termWidth } = useTerminalDimensions();

	if (!mode || options.length === 0) return null;

	const effectiveWidth = props.containerWidth ?? termWidth;
	const rowBudget = Math.max(10, effectiveWidth - 4);
	const safeSelected = Math.max(0, Math.min(selected, options.length - 1));

	if (options.length <= MAX_ROWS) {
		return (
			<box
				flexDirection="column"
				border
				borderStyle="rounded"
				borderColor="gray"
			>
				{options.map((opt, i) => (
					<OptionRow
						key={opt.display}
						opt={opt}
						isSelected={i === safeSelected}
						rowBudget={rowBudget}
						mode={mode}
						accent={accent}
						onSelect={onSelect}
					/>
				))}
			</box>
		);
	}

	const halfWindow = Math.floor(MAX_ROWS / 2);
	let start = Math.max(0, safeSelected - halfWindow);
	if (start + MAX_ROWS > options.length) {
		start = options.length - MAX_ROWS;
	}

	const moreAbove = start;
	const moreBelow = options.length - (start + MAX_ROWS);
	const showAboveIndicator = moreAbove > 0;
	const showBelowIndicator = moreBelow > 0;

	const itemSlots =
		MAX_ROWS - (showAboveIndicator ? 1 : 0) - (showBelowIndicator ? 1 : 0);
	const itemStart = showAboveIndicator ? start + 1 : start;
	const visibleItems = options.slice(itemStart, itemStart + itemSlots);

	const aboveCount = itemStart;
	const belowCount = options.length - (itemStart + itemSlots);

	return (
		<box flexDirection="column" border borderStyle="rounded" borderColor="gray">
			{showAboveIndicator && (
				<box paddingX={1} justifyContent="center">
					<text fg="gray">
						{"\u25b2"} {aboveCount} more
					</text>
				</box>
			)}
			{visibleItems.map((opt, i) => {
				const absoluteIdx = itemStart + i;
				return (
					<OptionRow
						key={opt.display}
						opt={opt}
						isSelected={absoluteIdx === safeSelected}
						rowBudget={rowBudget}
						mode={mode}
						accent={accent}
						onSelect={onSelect}
					/>
				);
			})}
			{showBelowIndicator && (
				<box paddingX={1} justifyContent="center">
					<text fg="gray">
						{"\u25bc"} {belowCount} more
					</text>
				</box>
			)}
		</box>
	);
}

function truncateEnd(str: string, max: number): string {
	if (str.length <= max) return str;
	return `${str.slice(0, max - 1)}\u2026`;
}

function truncateStart(str: string, max: number): string {
	if (str.length <= max) return str;
	return `\u2026${str.slice(-(max - 1))}`;
}

function OptionRow(props: {
	opt: AutocompleteOption;
	isSelected: boolean;
	rowBudget: number;
	mode: AutocompleteMode;
	accent: string;
	onSelect: (option: AutocompleteOption) => void;
}) {
	const terminalBg = useTerminalBackground();
	const defaultFg = getDefaultForeground(terminalBg);
	const { opt, isSelected, rowBudget, mode, accent, onSelect } = props;

	if (opt.isHeader) {
		return (
			<box paddingX={1}>
				<text fg="gray">{opt.display}</text>
			</box>
		);
	}

	const prefix = isSelected ? "\u276f " : "  ";
	const budgetAfterPrefix = rowBudget - prefix.length;

	let displayName: string;
	let descText = "";

	if (mode === "@") {
		displayName = truncateStart(opt.display, budgetAfterPrefix);
	} else {
		if (opt.description) {
			const descColumnBudget = Math.max(
				0,
				Math.floor(budgetAfterPrefix * 0.62),
			);
			const displayBudget = Math.max(
				1,
				budgetAfterPrefix - descColumnBudget - 1,
			);
			displayName = truncateEnd(opt.display, displayBudget);
			if (descColumnBudget > 3) {
				descText = truncateEnd(opt.description, descColumnBudget);
			}
		} else {
			displayName = truncateEnd(opt.display, budgetAfterPrefix);
		}
	}

	const descGap = descText
		? Math.max(1, budgetAfterPrefix - displayName.length - descText.length)
		: 0;

	return (
		<box
			paddingX={1}
			backgroundColor={isSelected ? accent : undefined}
			onMouseDown={() => onSelect(opt)}
		>
			<text wrapMode="none">
				<span fg={isSelected ? palette.textOnSelection : "gray"}>{prefix}</span>
				<span fg={isSelected ? palette.textOnSelection : defaultFg}>
					{displayName}
				</span>
				{descText ? (
					<span fg={isSelected ? palette.textOnSelection : "gray"}>
						{" ".repeat(descGap)}
						{descText}
					</span>
				) : null}
			</text>
		</box>
	);
}
