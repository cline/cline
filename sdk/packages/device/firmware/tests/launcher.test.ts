import { describe, expect, test } from "bun:test";
import {
	mkdtemp,
	mkdir,
	readFile,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAUNCHER_BINARY, packageLauncher } from "../tools/launcher";

async function fixture(run: (dir: string, image: Buffer) => Promise<void>) {
	const dir = await mkdtemp(join(tmpdir(), "cline-launcher-"));
	try {
		await mkdir(join(dir, "config"));
		await writeFile(
			join(dir, "config/sdkconfig.json"),
			JSON.stringify({ DEVICE_BOARD_ID: "m5stack-cardputer-adv" }),
		);
		await writeFile(
			join(dir, "project_description.json"),
			JSON.stringify({
				target: "esp32s3",
				project_name: "cline_device",
				app_bin: "cline_device.bin",
			}),
		);
		const image = Buffer.alloc(4096);
		image[0] = 0xe9;
		image.writeUInt16LE(9, 12);
		image.writeUInt32LE(0xabcd5432, 32);
		image.write("cline_device", 80);
		await writeFile(join(dir, "cline_device.bin"), image);
		await run(dir, image);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

describe("M5Launcher packaging", () => {
	test("copies only the app unchanged and records its actual size", async () => {
		await fixture(async (dir, image) => {
			await writeFile(join(dir, "bootloader.bin"), "never include this");
			const output = await packageLauncher(dir);
			expect(await readFile(output)).toEqual(image);
			expect((await readdir(join(dir, "launcher"))).sort()).toEqual(
				[LAUNCHER_BINARY, `${LAUNCHER_BINARY}.sha256`, "README.txt"].sort(),
			);
			expect(
				await readFile(join(dir, "launcher/README.txt"), "utf8"),
			).toContain("4096 bytes");
		});
	});
	test("rejects another board or a merged bootloader image", async () => {
		await fixture(async (dir, image) => {
			image.writeUInt32LE(0, 32);
			await writeFile(join(dir, "cline_device.bin"), image);
			await expect(packageLauncher(dir)).rejects.toThrow("application image");
			await writeFile(
				join(dir, "config/sdkconfig.json"),
				JSON.stringify({ DEVICE_BOARD_ID: "waveshare-s3-175c" }),
			);
			await expect(packageLauncher(dir)).rejects.toThrow("Cardputer ADV build");
		});
	});
});
