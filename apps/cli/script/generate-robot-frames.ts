import { fileURLToPath } from "node:url";

const WIDTH = 34;
const HEIGHT = 12;
const FRAME_COUNT = 192;

const PALETTE = ["black", "whiteBright", "gray"] as const;
const CHARACTER_RAMP = " .:;+*#@";

// Character-grid rendering of the canonical 113x113 Cline mark. The outline
// stays fixed while the two eye bars move horizontally to follow the cursor.
const OUTLINE_ROWS = [
	"             .+#**#+.             ",
	"         ....*@:  :@*....         ",
	"      .+#*****+    +*****#+.      ",
	"      +@:                :@+      ",
	"      *@.                .@+      ",
	"     +#+                  *#+     ",
	"   ;#*.                    .*#;   ",
	"   :*#:                    :#*:   ",
	"     ;#*.                .*#;     ",
	"      *@.                .@+      ",
	"      +@:                :@+      ",
	"       +#****************#+       ",
] as const;

const EYE_ROWS = [
	"                                  ",
	"                                  ",
	"                                  ",
	"                                  ",
	"                                  ",
	"            ;*:    :*;            ",
	"            *@+    +@*            ",
	"            *@+    +@*            ",
	"            :+.    :+:            ",
	"                                  ",
	"                                  ",
	"                                  ",
] as const;

type EncodedFrame = [rows: string[], colorRuns: number[]];

function intensity(character: string): number {
	const index = CHARACTER_RAMP.indexOf(character);
	if (index === -1) {
		throw new Error(`Unsupported robot-frame character: ${character}`);
	}
	return index / (CHARACTER_RAMP.length - 1);
}

function characterAt(value: number): string {
	const index = Math.max(
		0,
		Math.min(
			CHARACTER_RAMP.length - 1,
			Math.round(value * (CHARACTER_RAMP.length - 1)),
		),
	);
	return CHARACTER_RAMP[index] ?? " ";
}

function eyeOffsetForFrame(frameIndex: number): number {
	const keyframes: [frame: number, offset: number][] = [
		[0, 0],
		[64, -2],
		[96, 0],
		[128, 2],
		[FRAME_COUNT - 1, 0],
	];

	for (let index = 1; index < keyframes.length; index++) {
		const [endFrame, endOffset] = keyframes[index] ?? [0, 0];
		const [startFrame, startOffset] = keyframes[index - 1] ?? [0, 0];
		if (frameIndex <= endFrame) {
			const progress = (frameIndex - startFrame) / (endFrame - startFrame);
			return startOffset + (endOffset - startOffset) * progress;
		}
	}

	return 0;
}

function translateEyeRow(row: string, offset: number): number[] {
	const translated = Array.from({ length: WIDTH }, () => 0);

	for (let sourceX = 0; sourceX < WIDTH; sourceX++) {
		const value = intensity(row[sourceX] ?? " ");
		if (value === 0) continue;

		const targetX = sourceX + offset;
		const leftX = Math.floor(targetX);
		const rightX = leftX + 1;
		const rightWeight = targetX - leftX;
		const leftWeight = 1 - rightWeight;

		if (leftX >= 0 && leftX < WIDTH) {
			translated[leftX] = Math.max(translated[leftX] ?? 0, value * leftWeight);
		}
		if (rightX >= 0 && rightX < WIDTH) {
			translated[rightX] = Math.max(
				translated[rightX] ?? 0,
				value * rightWeight,
			);
		}
	}

	return translated;
}

function buildRows(frameIndex: number): string[] {
	const eyeOffset = eyeOffsetForFrame(frameIndex);

	return OUTLINE_ROWS.map((outlineRow, rowIndex) => {
		const eyeValues = translateEyeRow(EYE_ROWS[rowIndex] ?? "", eyeOffset);
		return Array.from({ length: WIDTH }, (_, columnIndex) => {
			const outlineValue = intensity(outlineRow[columnIndex] ?? " ");
			return characterAt(Math.max(outlineValue, eyeValues[columnIndex] ?? 0));
		}).join("");
	});
}

function paletteIndex(character: string): number {
	if (character === " ") return 0;
	if (character === "@" || character === "#" || character === "*") return 1;
	return 2;
}

function encodeColorRuns(rows: string[]): number[] {
	const paletteIndexes = rows.flatMap((row) => Array.from(row, paletteIndex));
	const runs: number[] = [];

	for (const index of paletteIndexes) {
		const previousPaletteIndex = runs.at(-1);
		if (previousPaletteIndex === index) {
			runs[runs.length - 2] = (runs[runs.length - 2] ?? 0) + 1;
		} else {
			runs.push(1, index);
		}
	}

	return runs;
}

function buildFrame(frameIndex: number): EncodedFrame {
	const rows = buildRows(frameIndex);
	return [rows, encodeColorRuns(rows)];
}

for (const rows of [OUTLINE_ROWS, EYE_ROWS]) {
	if (rows.length !== HEIGHT || rows.some((row) => row.length !== WIDTH)) {
		throw new Error(`Robot frame source must be ${WIDTH}x${HEIGHT}`);
	}
}

const output = {
	schema: 1,
	width: WIDTH,
	height: HEIGHT,
	palette: PALETTE,
	frames: Array.from({ length: FRAME_COUNT }, (_, frameIndex) =>
		buildFrame(frameIndex),
	),
};

const outputPath = new URL(
	"../src/tui/components/robot-frames.generated.json",
	import.meta.url,
);
await Bun.write(outputPath, `${JSON.stringify(output, null, "\t")}\n`);

const biomePath = new URL(
	"../../../node_modules/@biomejs/biome/bin/biome",
	import.meta.url,
);
const formatter = Bun.spawn(
	[
		"bun",
		fileURLToPath(biomePath),
		"format",
		"--write",
		fileURLToPath(outputPath),
	],
	{
		stdout: "inherit",
		stderr: "inherit",
	},
);
if ((await formatter.exited) !== 0) {
	throw new Error("Failed to format generated robot frames");
}
