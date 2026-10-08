// Exercises the png module (export sizing, SVG raster preparation, size-limit
// retries) of `components/diagrams/mermaid/` via the public façade.

import { describe, expect, test, vi } from "vitest";
import {
	computeExportScale,
	computePngExportSize,
	encodePngWithinLimit,
	PNG_EXPORT,
	pngFitsAttachmentLimit,
	prepareSvgForRaster,
	resolvePngDesiredScale,
} from "../../../components/mermaid-diagram";

describe("resolvePngDesiredScale", () => {
	test("never goes below the 2x base, even on 1x displays", () => {
		expect(resolvePngDesiredScale(1)).toBe(PNG_EXPORT.baseScale);
		expect(resolvePngDesiredScale(0.5)).toBe(PNG_EXPORT.baseScale);
	});

	test("follows the device pixel ratio up to the max", () => {
		expect(resolvePngDesiredScale(2)).toBe(2);
		expect(resolvePngDesiredScale(2.5)).toBe(3);
		expect(resolvePngDesiredScale(3)).toBe(3);
		expect(resolvePngDesiredScale(5)).toBe(PNG_EXPORT.maxDesiredScale);
	});

	test("falls back to the base scale for missing or invalid ratios", () => {
		expect(resolvePngDesiredScale()).toBe(PNG_EXPORT.baseScale);
		expect(resolvePngDesiredScale(null)).toBe(PNG_EXPORT.baseScale);
		expect(resolvePngDesiredScale(Number.NaN)).toBe(PNG_EXPORT.baseScale);
		expect(resolvePngDesiredScale(Number.POSITIVE_INFINITY)).toBe(
			PNG_EXPORT.baseScale,
		);
	});
});

describe("computeExportScale", () => {
	test("keeps the base scale for small diagrams instead of Streamdown's 5x", () => {
		expect(computeExportScale({ height: 200, width: 300 })).toBe(
			PNG_EXPORT.baseScale,
		);
		expect(computeExportScale({ height: 200, width: 300 }, 3)).toBe(3);
	});

	test("caps huge diagrams so the longest edge is at most the max", () => {
		const size = { height: 3000, width: 9000 };
		const scale = computeExportScale(size);
		expect(scale).toBeCloseTo(PNG_EXPORT.maxEdge / 9000);
		expect(Math.max(size.width, size.height) * scale).toBeLessThanOrEqual(
			PNG_EXPORT.maxEdge + 1e-9,
		);
		expect(computeExportScale({ height: 1000, width: 1000 }, 5, 2000)).toBe(2);
	});

	test("never returns NaN or Infinity for degenerate sizes", () => {
		for (const size of [
			{ height: 0, width: 0 },
			{ height: Number.NaN, width: Number.POSITIVE_INFINITY },
			{ height: -5, width: -1 },
		]) {
			const scale = computeExportScale(size);
			expect(Number.isFinite(scale), JSON.stringify(size)).toBe(true);
			expect(scale).toBeGreaterThan(0);
		}
	});
});

describe("computePngExportSize", () => {
	test("uses the desired scale for small diagrams", () => {
		expect(computePngExportSize({ height: 600, width: 800 })).toEqual({
			height: 1200,
			scale: 2,
			width: 1600,
		});
		expect(computePngExportSize({ height: 600, width: 800 }, 3)).toEqual({
			height: 1800,
			scale: 3,
			width: 2400,
		});
	});

	test("caps the longest edge at ~4096px", () => {
		const size = computePngExportSize({ height: 500, width: 3000 }, 3);
		expect(size.width).toBe(PNG_EXPORT.maxEdge);
		expect(size.height).toBe(683);
		expect(size.scale).toBeCloseTo(4096 / 3000);
		const tall = computePngExportSize({ height: 3000, width: 400 });
		expect(tall.height).toBeLessThanOrEqual(PNG_EXPORT.maxEdge);
	});

	test("shrinks a diagram that is already past the cap so the edge never exceeds it", () => {
		const wide = computePngExportSize({ height: 100, width: 8192 });
		expect(wide.width).toBe(PNG_EXPORT.maxEdge);
		expect(wide.scale).toBeCloseTo(0.5);
		expect(wide.height).toBe(50);
		const tall = computePngExportSize({ height: 6807, width: 259 });
		expect(tall.height).toBe(PNG_EXPORT.maxEdge);
		expect(tall.scale).toBeLessThan(1);
		expect(tall.width).toBeGreaterThanOrEqual(1);
	});

	test("never exceeds the cap on either edge for any input size", () => {
		for (const [width, height] of [
			[1, 1],
			[300, 200],
			[1365, 900],
			[4096, 10],
			[5000, 5000],
			[20000, 30],
		] as const) {
			const size = computePngExportSize({ height, width });
			expect(size.width).toBeLessThanOrEqual(PNG_EXPORT.maxEdge);
			expect(size.height).toBeLessThanOrEqual(PNG_EXPORT.maxEdge);
		}
	});

	test("tolerates degenerate sizes", () => {
		const size = computePngExportSize({ height: 0, width: Number.NaN });
		expect(size.width).toBeGreaterThanOrEqual(1);
		expect(size.height).toBeGreaterThanOrEqual(1);
	});
});

describe("encodePngWithinLimit", () => {
	const OVERSIZE = PNG_EXPORT.maxEncodedBytes; // base64 pushes this past the cap

	test("accounts for base64 expansion when checking the attachment limit", () => {
		expect(pngFitsAttachmentLimit(1024)).toBe(true);
		expect(pngFitsAttachmentLimit(3 * 1024 * 1024)).toBe(true);
		expect(pngFitsAttachmentLimit(4 * 1024 * 1024)).toBe(false);
		expect(pngFitsAttachmentLimit(OVERSIZE)).toBe(false);
	});

	test("encodes once at the desired scale when the PNG already fits", async () => {
		const encode = vi.fn(async () => ({ size: 1000 }));
		await encodePngWithinLimit({ height: 600, width: 800 }, encode);
		expect(encode).toHaveBeenCalledTimes(1);
		expect(encode).toHaveBeenCalledWith({
			height: 1200,
			scale: 2,
			width: 1600,
		});
	});

	test("starts from a custom initial scale (device pixel ratio)", async () => {
		const encode = vi.fn(async () => ({ size: 1000 }));
		await encodePngWithinLimit({ height: 600, width: 800 }, encode, 3);
		expect(encode).toHaveBeenCalledOnce();
		expect(encode).toHaveBeenCalledWith({
			height: 1800,
			scale: 3,
			width: 2400,
		});
	});

	test("retries at a lower scale until the PNG fits, never below 1x", async () => {
		const scales: number[] = [];
		const result = await encodePngWithinLimit(
			{ height: 600, width: 800 },
			async (size) => {
				scales.push(size.scale);
				return { size: size.scale > 1.5 ? OVERSIZE : 1000 };
			},
		);
		expect(result.size).toBe(1000);
		expect(scales[0]).toBe(PNG_EXPORT.baseScale);
		expect(scales.length).toBeGreaterThan(1);
		expect(scales.at(-1)).toBeLessThanOrEqual(1.5);
		expect(Math.min(...scales)).toBeGreaterThanOrEqual(1);
		// Strictly decreasing, so retries always make progress.
		scales.forEach((scale, index) => {
			if (index > 0) expect(scale).toBeLessThan(scales[index - 1] ?? 0);
		});
	});

	test("stops at 1x and returns the smallest attempt when nothing fits", async () => {
		const scales: number[] = [];
		const result = await encodePngWithinLimit(
			{ height: 600, width: 800 },
			async (size) => {
				scales.push(size.scale);
				return { scale: size.scale, size: OVERSIZE };
			},
		);
		expect(scales.at(-1)).toBe(1);
		expect(result.scale).toBe(1);
		expect(scales.length).toBeLessThanOrEqual(PNG_EXPORT.attemptLimit);
	});

	test("does not retry when the edge cap already forced the scale below 1x", async () => {
		const encode = vi.fn(async () => ({ size: OVERSIZE }));
		await encodePngWithinLimit({ height: 100, width: 8192 }, encode);
		expect(encode).toHaveBeenCalledTimes(1);
	});

	test("propagates encoder failures", async () => {
		await expect(
			encodePngWithinLimit({ height: 10, width: 10 }, async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
	});
});

describe("prepareSvgForRaster", () => {
	test("gives a 100%-wide Mermaid SVG the intrinsic viewBox size", () => {
		const prepared = prepareSvgForRaster(
			'<svg id="m" width="100%" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150" style="max-width: 300px;"><g/></svg>',
		);
		expect(prepared.width).toBe(300);
		expect(prepared.height).toBe(150);
		expect(prepared.svg).toContain('width="300"');
		expect(prepared.svg).toContain('height="150"');
		expect(prepared.svg).not.toContain("100%");
		expect(prepared.svg).not.toContain("max-width");
	});

	test("adds missing namespaces and makes HTML entities XML-safe", () => {
		const prepared = prepareSvgForRaster(
			'<svg viewBox="0 0 10 10"><text>a&nbsp;b</text><use xlink:href="#x"/><br></svg>',
		);
		expect(prepared.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
		expect(prepared.svg).toContain(
			'xmlns:xlink="http://www.w3.org/1999/xlink"',
		);
		expect(prepared.svg).toContain("a&#160;b");
		expect(prepared.svg).toContain("<br/>");
	});

	test("falls back to a default size without a viewBox or root tag", () => {
		expect(prepareSvgForRaster("<div/>").width).toBeGreaterThan(0);
		expect(
			prepareSvgForRaster('<svg width="120" height="80"></svg>'),
		).toMatchObject({ height: 80, width: 120 });
	});
});
