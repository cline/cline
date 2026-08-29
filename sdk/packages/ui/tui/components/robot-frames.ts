import encodedFrames from "./robot-frames.generated.json";

export interface CroppedFrame {
	rows: string[];
	colors: Record<string, string>;
}

interface EncodedRobotFrames {
	schema: 1;
	width: number;
	height: number;
	palette: string[];
	frames: [rows: string[], colorRuns: number[]][];
}

function decodeRunLengthColors(
	colorRuns: number[],
	palette: string[],
	width: number,
	height: number,
): Record<string, string> {
	const colors: Record<string, string> = {};
	let cellIndex = 0;

	for (let offset = 0; offset < colorRuns.length; offset += 2) {
		const count = colorRuns[offset];
		const paletteIndex = colorRuns[offset + 1];
		if (count === undefined || paletteIndex === undefined) {
			throw new Error(`Invalid robot frame color run at offset ${offset}`);
		}

		const color = palette[paletteIndex];
		if (!color) {
			throw new Error(`Unknown robot frame palette index ${paletteIndex}`);
		}

		for (let i = 0; i < count; i++) {
			const x = cellIndex % width;
			const y = Math.floor(cellIndex / width);
			colors[`${x},${y}`] = color;
			cellIndex++;
		}
	}

	const expectedCells = width * height;
	if (cellIndex !== expectedCells) {
		throw new Error(
			`Robot frame decoded to ${cellIndex} cells, expected ${expectedCells}`,
		);
	}

	return colors;
}

function decodeRobotFrames(encoded: EncodedRobotFrames): CroppedFrame[] {
	if (encoded.schema !== 1) {
		throw new Error(`Unsupported robot frame schema ${encoded.schema}`);
	}

	return encoded.frames.map(([rows, colorRuns]) => ({
		rows,
		colors: decodeRunLengthColors(
			colorRuns,
			encoded.palette,
			encoded.width,
			encoded.height,
		),
	}));
}

export const FRAMES: CroppedFrame[] = decodeRobotFrames(
	encodedFrames as EncodedRobotFrames,
);
