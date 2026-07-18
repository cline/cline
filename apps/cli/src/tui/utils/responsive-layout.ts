export interface StatusRowLayout {
	leftWidth: number;
	showRight: boolean;
}

export function truncateToWidth(value: string, width: number): string {
	const normalizedWidth = Math.max(0, Math.floor(width));
	if (value.length <= normalizedWidth) return value;
	if (normalizedWidth === 0) return "";
	if (normalizedWidth === 1) return "…";
	return `${value.slice(0, normalizedWidth - 1)}…`;
}

export function fitStatusRow(
	availableWidth: number,
	rightWidth: number,
	minimumLeftWidth = 8,
): StatusRowLayout {
	const width = Math.max(1, Math.floor(availableWidth));
	const normalizedRightWidth = Math.max(0, Math.floor(rightWidth));
	const normalizedMinimumLeftWidth = Math.max(1, Math.floor(minimumLeftWidth));
	const showRight =
		normalizedRightWidth > 0 &&
		width >= normalizedMinimumLeftWidth + normalizedRightWidth + 1;

	return {
		leftWidth: showRight ? width - normalizedRightWidth - 1 : width,
		showRight,
	};
}

export function getHomeShortcutHint(width: number): string {
	const fullHint = "/ commands  @ files  Ctrl+P menu";
	const compactHint = "/ commands  @ files";
	return truncateToWidth(
		width >= fullHint.length ? fullHint : compactHint,
		width,
	);
}
