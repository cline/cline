import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
	parseTiffInfo,
	readPngDimensions,
	validateTiffRepresentations,
} from "./dmg-background";

const DMG_ROOT = path.resolve(import.meta.dir, "..", "src-tauri", "dmg");

const EXPECTED_REPRESENTATIONS = [
	{ width: 640, height: 400, dpiX: 72, dpiY: 72 },
	{ width: 1280, height: 800, dpiX: 144, dpiY: 144 },
];

const TIFF_INFO = `Directory at 0x1
  Image Width: 640 Image Length: 400
  Resolution: 72, 72
  Resolution Unit: pixels/inch
Directory at 0x2
  Image Width: 1280 Image Length: 800
  Resolution: 144, 144
  Resolution Unit: pixels/inch
`;

describe("parseTiffInfo", () => {
	test("reads the dimensions and DPI of every TIFF representation", () => {
		expect(parseTiffInfo(TIFF_INFO)).toEqual(EXPECTED_REPRESENTATIONS);
	});

	test("rejects representations without pixel-per-inch resolution", () => {
		expect(() =>
			parseTiffInfo(TIFF_INFO.replace("pixels/inch", "pixels/cm")),
		).toThrow(/could not parse TIFF representation/);
	});
});

describe("DMG source artwork", () => {
	test("has the expected 1x and 2x dimensions", async () => {
		const [dimensions1x, dimensions2x] = await Promise.all([
			readPngDimensions(path.join(DMG_ROOT, "background.png")),
			readPngDimensions(path.join(DMG_ROOT, "background@2x.png")),
		]);

		expect(dimensions1x).toEqual({ width: 640, height: 400 });
		expect(dimensions2x).toEqual({ width: 1280, height: 800 });
	});
});

describe("validateTiffRepresentations", () => {
	test("accepts the expected representations", () => {
		expect(() =>
			validateTiffRepresentations(EXPECTED_REPRESENTATIONS),
		).not.toThrow();
	});

	test("rejects the wrong number of representations", () => {
		expect(() =>
			validateTiffRepresentations(EXPECTED_REPRESENTATIONS.slice(0, 1)),
		).toThrow(/exactly two image representations/);
	});

	test("rejects incorrect representation dimensions", () => {
		expect(() =>
			validateTiffRepresentations([
				EXPECTED_REPRESENTATIONS[0],
				{ ...EXPECTED_REPRESENTATIONS[1], width: 1279 },
			]),
		).toThrow(/must be 1280x800/);
	});

	test("rejects incorrect representation DPI", () => {
		expect(() =>
			validateTiffRepresentations([
				{ ...EXPECTED_REPRESENTATIONS[0], dpiX: 73 },
				EXPECTED_REPRESENTATIONS[1],
			]),
		).toThrow(/must be 72x72 DPI/);
	});
});
