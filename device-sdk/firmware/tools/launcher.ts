import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

export const LAUNCHER_BOARD = "m5stack-cardputer-adv";
export const LAUNCHER_BINARY = "Cline-Device-Cardputer-ADV.bin";

/** Export only the application image; Launcher owns bootloader/partition data. */
export async function packageLauncher(buildDir: string): Promise<string> {
	const description = JSON.parse(
		await readFile(join(buildDir, "project_description.json"), "utf8"),
	);
	const config = JSON.parse(
		await readFile(join(buildDir, "config/sdkconfig.json"), "utf8"),
	);
	if (
		description.target !== "esp32s3" ||
		description.project_name !== "cline_device" ||
		config.DEVICE_BOARD_ID !== LAUNCHER_BOARD ||
		typeof description.app_bin !== "string" ||
		basename(description.app_bin) !== description.app_bin
	) {
		throw new Error(
			"Launcher packaging requires a Cline Device Cardputer ADV build.",
		);
	}
	const binary = await readFile(join(buildDir, description.app_bin));
	// ESP image header (24 bytes), segment header (8), then esp_app_desc_t.
	if (
		binary.length < 288 ||
		binary[0] !== 0xe9 ||
		binary.readUInt16LE(12) !== 9 || // ESP32-S3 chip ID
		binary.readUInt32LE(32) !== 0xabcd5432 ||
		binary.subarray(80, 112).toString("utf8").split("\0")[0] !== "cline_device"
	) {
		throw new Error(
			"Expected an ESP32-S3 Cline application image, not a merged/factory image.",
		);
	}
	const output = resolve(buildDir, "launcher");
	await mkdir(output, { recursive: true });
	const destination = join(output, LAUNCHER_BINARY);
	await writeFile(destination, binary);
	const sha256 = createHash("sha256").update(binary).digest("hex");
	await writeFile(
		join(output, `${LAUNCHER_BINARY}.sha256`),
		`${sha256}  ${LAUNCHER_BINARY}\n`,
	);
	await writeFile(
		join(output, "README.txt"),
		`Cline Device for Cardputer ADV — M5Launcher app image

Copy ${LAUNCHER_BINARY} to your microSD card.
In M5Launcher: SD > select the file > Install.
You can also upload the .bin using Launcher's WUI.
This package contains only the app: no bootloader, partition table or data image.
It does not require SPIFFS/FAT data. Keep your existing launcher partition layout.
Choose a free app slot with at least ${binary.length} bytes available.
If the launcher proposes replacing an installed app, choose a free slot instead.

To return: reset/power-cycle and press Enter at the Launcher startup screen.
Pair through the Cline dashboard and the device's Wi-Fi setup page as usual.
Cline stores credentials in its NVS namespace; NVS is shared with other apps.
Do not use idf.py flash or erase_flash to install this package.

Board: ${LAUNCHER_BOARD}
Build: ${description.project_version ?? "unknown"}
App bytes: ${binary.length}
SHA256: ${sha256}
Hardware installation/return-to-launcher still needs testing on your device.
Guide: https://github.com/bmorcelli/Launcher/wiki/Obtaining-binaries-to-launch
`,
	);
	return destination;
}

if (import.meta.main) {
	const buildDir = process.argv[2];
	if (!buildDir || process.argv.length !== 3) {
		console.error(
			"Usage: bun firmware/tools/launcher.ts <Cardputer ADV build directory>",
		);
		process.exit(1);
	}
	console.log(await packageLauncher(buildDir));
}
