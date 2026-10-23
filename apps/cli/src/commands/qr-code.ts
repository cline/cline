import qrcode from "qrcode-generator";

// ---------------------------------------------------------------------------
// Terminal QR rendering
//
// Two renderings of the same matrix: raw half-block lines, and the same lines
// wrapped in explicit black-on-white ANSI. The TUI needs the raw form because it
// applies its own colours through the renderer instead of emitting escapes.
// ---------------------------------------------------------------------------

const QUIET_ZONE = 2;

/**
 * Renders `text` as half-block rows, two module rows per text row. No colour is
 * applied: the caller must guarantee dark-on-light, because an inverted QR will
 * not scan.
 */
export function renderQrCodeBlockLines(text: string): string[] {
	const qr = qrcode(0, "L");
	qr.addData(text);
	qr.make();

	const count = qr.getModuleCount();
	const size = count + QUIET_ZONE * 2;
	const isDark = (row: number, col: number): boolean => {
		const moduleRow = row - QUIET_ZONE;
		const moduleCol = col - QUIET_ZONE;
		if (
			moduleRow < 0 ||
			moduleCol < 0 ||
			moduleRow >= count ||
			moduleCol >= count
		) {
			return false;
		}
		return qr.isDark(moduleRow, moduleCol);
	};

	const lines: string[] = [];
	for (let row = 0; row < size; row += 2) {
		let line = "";
		for (let col = 0; col < size; col += 1) {
			const top = isDark(row, col);
			const bottom = row + 1 < size ? isDark(row + 1, col) : false;
			if (top && bottom) {
				line += "█";
			} else if (top) {
				line += "▀";
			} else if (bottom) {
				line += "▄";
			} else {
				line += " ";
			}
		}
		lines.push(line);
	}
	return lines;
}

/**
 * Renders the QR for a plain terminal. Explicit black-on-white colours are set so
 * polarity is correct on both light and dark terminal themes.
 */
export function renderQrCode(text: string): string[] {
	return renderQrCodeBlockLines(text).map(
		(line) => `\u001b[30;47m${line}\u001b[0m`,
	);
}
