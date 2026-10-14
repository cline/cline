import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyCliRelease } from "./verify-cli-release";

test("requires an already-published matching CLI release for every Unix target", async () => {
	const root = mkdtempSync(join(tmpdir(), "cline-pinned-release-"));
	try {
		writeFileSync(join(root, "release.txt"), "cli-v3.0.99\n");
		writeFileSync(
			join(root, "identity.json"),
			JSON.stringify({ buildId: "sdk-v1-fixture", buildEpochMs: 10 }),
		);
		const requests: string[] = [];
		const metadata = async (url: string) => {
			requests.push(url);
			if (url.endsWith(".build-id")) return "sdk-v1-fixture\n";
			if (url.endsWith(".build-epoch")) return "100\n";
			return `${"a".repeat(64)}  ${url.split("/").pop()?.replace(".sha256", "")}\n`;
		};
		await verifyCliRelease(root, metadata);
		expect(requests).toHaveLength(12);
		expect(requests.every((url) => url.includes("/cli-v3.0.99/"))).toBe(true);
		await expect(
			verifyCliRelease(root, async (url) =>
				url.endsWith(".build-id") ? "wrong-sdk" : metadata(url),
			),
		).rejects.toThrow("publish a matching CLI");
		await expect(
			verifyCliRelease(root, async () => {
				throw new Error("404");
			}),
		).rejects.toThrow("404");
		await expect(
			verifyCliRelease(root, async (url) =>
				url.endsWith(".build-epoch") ? "invalid" : metadata(url),
			),
		).rejects.toThrow("Invalid CLI build epoch");
		await expect(
			verifyCliRelease(root, async (url) =>
				url.endsWith(".sha256") ? "corrupt" : metadata(url),
			),
		).rejects.toThrow("Invalid CLI checksum");
		writeFileSync(join(root, "release.txt"), "cli-latest\n");
		await expect(verifyCliRelease(root, metadata)).rejects.toThrow(
			"exact CLI release",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
