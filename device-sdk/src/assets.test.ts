import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AVATAR_ROOT, FIRMWARE_ROOT, WEB_ROOT } from "./assets";

test("SDK resources are independent of the host app", () => {
	const manifest = JSON.parse(
		readFileSync(join(AVATAR_ROOT, "manifest.json"), "utf8"),
	);
	const avatar = manifest.avatars[manifest.defaultAvatar];
	for (const device of Object.values(manifest.devices) as {
		variant: string;
	}[]) {
		for (const frames of Object.values(
			avatar.variants[device.variant].states,
		) as string[][]) {
			for (const frame of frames)
				expect(existsSync(join(AVATAR_ROOT, frame))).toBe(true);
		}
	}
	expect(existsSync(join(FIRMWARE_ROOT, "CMakeLists.txt"))).toBe(true);
	expect(existsSync(join(WEB_ROOT, "index.html"))).toBe(true);
});
