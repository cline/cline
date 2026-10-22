import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { $ } from "bun";

type Dimensions = {
	width: number;
	height: number;
};

type TiffRepresentation = Dimensions & {
	dpiX: number;
	dpiY: number;
};

const APP_ROOT = path.resolve(import.meta.dir, "..");
const DMG_ROOT = path.join(APP_ROOT, "src-tauri", "dmg");
const BACKGROUND_1X = path.join(DMG_ROOT, "background.png");
const BACKGROUND_2X = path.join(DMG_ROOT, "background@2x.png");
// Gitignored build artifact; only the PNG sources are committed.
const BACKGROUND_TIFF = path.join(DMG_ROOT, "background.gen.tiff");

const EXPECTED_1X = { width: 640, height: 400 };
const EXPECTED_2X = { width: 1280, height: 800 };
const EXPECTED_TIFF_REPRESENTATIONS: TiffRepresentation[] = [
	{ ...EXPECTED_1X, dpiX: 72, dpiY: 72 },
	{ ...EXPECTED_2X, dpiX: 144, dpiY: 144 },
];

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

// PNG stores its big-endian width and height in the fixed IHDR fields at
// byte offsets 16 and 20, so dimensions can be checked without an image library.
export const readPngDimensions = async (
	filePath: string,
): Promise<Dimensions> => {
	const contents = await readFile(filePath);
	const hasPngSignature = PNG_SIGNATURE.every(
		(byte, index) => contents[index] === byte,
	);
	if (
		contents.length < 24 ||
		!hasPngSignature ||
		contents.toString("ascii", 12, 16) !== "IHDR"
	) {
		throw new Error(`${filePath} is not a valid PNG with an IHDR header`);
	}

	return {
		width: contents.readUInt32BE(16),
		height: contents.readUInt32BE(20),
	};
};

const assertDimensions = (
	label: string,
	actual: Dimensions,
	expected: Dimensions,
): void => {
	if (actual.width !== expected.width || actual.height !== expected.height) {
		throw new Error(
			`${label} must be ${expected.width}x${expected.height}, got ${actual.width}x${actual.height}`,
		);
	}
};

// tiffutil prints one "Directory at ..." block for each image representation
// embedded in the TIFF.
export const parseTiffInfo = (output: string): TiffRepresentation[] =>
	output
		.split(/(?=Directory at )/)
		.filter((block) => block.startsWith("Directory at "))
		.map((block) => {
			const dimensions = block.match(
				/Image Width:\s*(\d+)\s+Image Length:\s*(\d+)/,
			);
			const resolution = block.match(/Resolution:\s*([\d.]+),\s*([\d.]+)/);
			if (
				!dimensions ||
				!resolution ||
				!block.includes("Resolution Unit: pixels/inch")
			) {
				throw new Error(`could not parse TIFF representation:\n${block}`);
			}

			return {
				width: Number(dimensions[1]),
				height: Number(dimensions[2]),
				dpiX: Number(resolution[1]),
				dpiY: Number(resolution[2]),
			};
		});

export const validateTiffRepresentations = (
	representations: TiffRepresentation[],
	label = "TIFF",
): void => {
	const sortedRepresentations = [...representations].sort(
		(left, right) => left.width - right.width,
	);

	if (sortedRepresentations.length !== EXPECTED_TIFF_REPRESENTATIONS.length) {
		throw new Error(
			`${label} must contain exactly two image representations, got ${sortedRepresentations.length}`,
		);
	}

	for (const [index, expected] of EXPECTED_TIFF_REPRESENTATIONS.entries()) {
		const actual = sortedRepresentations[index];
		assertDimensions(`${label} representation ${index + 1}`, actual, expected);
		if (actual.dpiX !== expected.dpiX || actual.dpiY !== expected.dpiY) {
			throw new Error(
				`${label} representation ${index + 1} must be ${expected.dpiX}x${expected.dpiY} DPI, got ${actual.dpiX}x${actual.dpiY} DPI`,
			);
		}
	}
};

const assertTiffRepresentations = async (filePath: string): Promise<void> => {
	const representations = parseTiffInfo(
		await $`tiffutil -info ${filePath}`.quiet().text(),
	);
	validateTiffRepresentations(representations, filePath);
};

const assertSourceDimensions = async (): Promise<void> => {
	const [dimensions1x, dimensions2x] = await Promise.all([
		readPngDimensions(BACKGROUND_1X),
		readPngDimensions(BACKGROUND_2X),
	]);
	assertDimensions("background.png", dimensions1x, EXPECTED_1X);
	assertDimensions("background@2x.png", dimensions2x, EXPECTED_2X);
};

const generateTiff = async (outputPath: string): Promise<void> => {
	// Finder's .DS_Store references one background file. A multi-representation
	// TIFF lets AppKit select the 1x or 2x bitmap without relying on it to discover
	// a separate @2x companion beside that referenced file.
	await $`tiffutil -cathidpicheck ${BACKGROUND_1X} ${BACKGROUND_2X} -out ${outputPath}`.quiet();
	await assertTiffRepresentations(outputPath);
};

const main = async (): Promise<void> => {
	if (process.argv.length > 2) {
		throw new Error("usage: bun run dmg:background");
	}
	if (process.platform !== "darwin") {
		// Runs from beforeBuildCommand on every platform, but only macOS builds
		// bundle a DMG and only macOS ships tiffutil.
		console.log("Skipping DMG background generation on non-macOS host.");
		return;
	}

	await assertSourceDimensions();
	// Generate and validate in scratch space so the configured build artifact is
	// replaced only after tiffutil has produced a complete, verified TIFF.
	const scratchRoot = await mkdtemp(
		path.join(tmpdir(), "cline-dmg-background-"),
	);
	const generatedTiff = path.join(scratchRoot, "background.tiff");
	try {
		await generateTiff(generatedTiff);
		await copyFile(generatedTiff, BACKGROUND_TIFF);
		console.log(`Generated ${path.relative(APP_ROOT, BACKGROUND_TIFF)}.`);
	} finally {
		await rm(scratchRoot, { force: true, recursive: true });
	}
};

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
