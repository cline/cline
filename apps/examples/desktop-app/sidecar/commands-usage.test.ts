import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// vi.mock is hoisted above this import, so the mocked modules are in place.
import { handleUsageCommand } from "./commands-usage";

// Redirect homedir() so exported cards land in a temp folder, not ~/Downloads.
const { fakeHome, spawnMock } = vi.hoisted(() => ({
	fakeHome: { path: "" },
	spawnMock: vi.fn(() => ({ once: vi.fn(), unref: vi.fn() })),
}));
vi.mock("node:os", async () => {
	const actual = await vi.importActual<typeof import("node:os")>("node:os");
	return { ...actual, homedir: () => fakeHome.path };
});
// Reveal must never launch a real file manager from a test run.
vi.mock("node:child_process", async () => {
	const actual =
		await vi.importActual<typeof import("node:child_process")>(
			"node:child_process",
		);
	return { ...actual, spawn: spawnMock };
});

/** 1x1 transparent PNG. */
const TINY_PNG =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

beforeEach(() => {
	fakeHome.path = mkdtempSync(join(tmpdir(), "cline-usage-share-"));
	spawnMock.mockClear();
});

afterEach(() => {
	rmSync(fakeHome.path, { recursive: true, force: true });
});

const ctx = {} as never;

async function exportCard(args: Record<string, unknown>) {
	return (await handleUsageCommand(ctx, "export_usage_share_card", args)) as {
		path: string;
		platform: string;
	};
}

describe("export_usage_share_card", () => {
	it("writes the card into Downloads and returns its path", async () => {
		const result = await exportCard({
			png: TINY_PNG,
			fileName: "cline-usage-30d-20260916.png",
		});

		expect(result.path).toBe(
			join(fakeHome.path, "Downloads", "cline-usage-30d-20260916.png"),
		);
		expect(result.platform).toBe(process.platform);
		// The bytes must survive the round trip, not just the file name.
		expect(readFileSync(result.path).subarray(1, 4).toString()).toBe("PNG");
	});

	it("never overwrites an earlier export with the same name", async () => {
		const first = await exportCard({
			png: TINY_PNG,
			fileName: "cline-usage-30d-20260916",
		});
		const second = await exportCard({
			png: TINY_PNG,
			fileName: "cline-usage-30d-20260916",
		});
		expect(first.path).not.toBe(second.path);
		expect(second.path.endsWith("cline-usage-30d-20260916-2.png")).toBe(true);
		expect(existsSync(first.path)).toBe(true);
	});

	it("strips path separators and keeps the share-card prefix", async () => {
		const result = await exportCard({
			png: TINY_PNG,
			fileName: "../../etc/passwd",
		});
		expect(result.path.startsWith(join(fakeHome.path, "Downloads"))).toBe(true);
		expect(result.path).not.toContain("..");
		expect(result.path.split("/").pop()).toMatch(/^cline-usage-.*\.png$/);
	});

	it("refuses anything that is not a PNG", async () => {
		await expect(
			exportCard({ png: "https://example.com/card.png" }),
		).rejects.toThrow(/base64 PNG data URL/);
		await expect(exportCard({})).rejects.toThrow(/base64 PNG data URL/);
		const html = Buffer.from("<html>not an image</html>").toString("base64");
		await expect(
			exportCard({ png: `data:image/png;base64,${html}` }),
		).rejects.toThrow(/not a PNG/);
	});

	it("refuses an oversized payload before decoding it", async () => {
		const huge = `data:image/png;base64,${"A".repeat(17 * 1024 * 1024)}`;
		await expect(exportCard({ png: huge })).rejects.toThrow(/too large/);
	});
});

describe("reveal_usage_share_card", () => {
	it("selects an exported card in the file manager", async () => {
		const { path } = await exportCard({
			png: TINY_PNG,
			fileName: "cline-usage-7d-20260916",
		});
		await handleUsageCommand(ctx, "reveal_usage_share_card", { path });
		expect(spawnMock).toHaveBeenCalledTimes(1);
		const [command, args] = spawnMock.mock.calls[0] as unknown as [
			string,
			string[],
		];
		if (process.platform === "darwin") {
			expect(command).toBe("open");
			expect(args).toEqual(["-R", path]);
		}
	});

	it("refuses paths that are not exported share cards", async () => {
		const downloads = join(fakeHome.path, "Downloads");
		mkdirSync(downloads, { recursive: true });
		const other = join(downloads, "tax-return.png");
		writeFileSync(other, "x");
		const outside = join(fakeHome.path, "cline-usage-30d-20260916.png");
		writeFileSync(outside, "x");

		for (const path of [other, outside, "relative/cline-usage-1.png"]) {
			await expect(
				handleUsageCommand(ctx, "reveal_usage_share_card", { path }),
			).rejects.toThrow();
		}
		await expect(
			handleUsageCommand(ctx, "reveal_usage_share_card", {
				path: join(downloads, "cline-usage-missing.png"),
			}),
		).rejects.toThrow(/no longer exists/);
		expect(spawnMock).not.toHaveBeenCalled();
	});
});
