import { describe, expect, it } from "bun:test";
import { cpSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AVATAR_ROOT } from "@cline/device/assets";
import { buildResponse, parseQuestions, readName } from "./mdns";
import { DeviceRegistry } from "./pairing";
import { resolveWebFile, WEB_ROOT } from "./server";
import { createPcmResampler } from "./transcribe";
import { pcmToWav } from "./wav";

describe("pcmToWav", () => {
	it("writes a 16 kHz mono 16-bit header", () => {
		const wav = pcmToWav(new Uint8Array(320));
		const v = new DataView(wav.buffer);
		expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
		expect(v.getUint32(24, true)).toBe(16_000);
		expect(v.getUint16(22, true)).toBe(1);
		expect(v.getUint32(40, true)).toBe(320);
		expect(wav.byteLength).toBe(364);
	});
});

describe("DeviceRegistry", () => {
	const file = () =>
		join(mkdtempSync(join(tmpdir(), "device-")), "devices.json");

	it("pairs once with a valid code and authenticates the token", () => {
		const path = file();
		const reg = new DeviceRegistry(path);
		const { code } = reg.issueCode();
		expect(
			reg.pair("000000" === code ? "111111" : "000000", "device"),
		).toBeUndefined();
		const token = reg.pair(code, "device");
		expect(token).toBeString();
		expect(reg.pair(code, "device")).toBeUndefined(); // single use
		expect(new DeviceRegistry(path).authenticate(token as string)?.name).toBe(
			"device",
		);
		expect(reg.authenticate("bogus")).toBeUndefined();
		expect(statSync(path).mode & 0o777).toBe(0o600);
	});

	it("expires codes and locks out brute force", () => {
		let now = 0;
		const reg = new DeviceRegistry(file(), () => now);
		const { code } = reg.issueCode();
		now += 6 * 60_000;
		expect(reg.pair(code, "device")).toBeUndefined();
		const fresh = reg.issueCode().code;
		const wrong = fresh === "999999" ? "000000" : "999999";
		for (let i = 0; i < 5; i++) reg.pair(wrong, "device");
		expect(reg.pair(fresh, "device")).toBeUndefined();
	});
});

describe("mdns", () => {
	it("answers with PTR/SRV/TXT/A records that round-trip names", () => {
		const res = buildResponse(
			{ instance: "Cline Device Bridge", port: 25470, txt: { v: "1" } },
			"laptop",
			["192.168.1.5"],
		);
		expect(res.readUInt16BE(6)).toBe(4);
		expect(readName(res, 12)[0]).toBe("_clinedevice._tcp.local");
		expect(res.includes(Buffer.from([192, 168, 1, 5]))).toBe(true);
	});

	it("parses questions from a query and ignores responses", () => {
		const q = Buffer.concat([
			Buffer.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]),
			Buffer.from([
				Buffer.byteLength("_clinedevice"),
				...Buffer.from("_clinedevice"),
				4,
				...Buffer.from("_tcp"),
				5,
				...Buffer.from("local"),
				0,
			]),
			Buffer.from([0, 12, 0, 1]),
		]);
		expect(parseQuestions(q)).toEqual([
			{ name: "_clinedevice._tcp.local", type: 12 },
		]);
		const r = Buffer.from(q);
		r.writeUInt16BE(0x8400, 2);
		expect(parseQuestions(r)).toEqual([]);
	});
});

describe("createPcmResampler", () => {
	const pcm = (samples: number[]) => {
		const b = new Uint8Array(samples.length * 2);
		const v = new DataView(b.buffer);
		samples.forEach((s, i) => {
			v.setInt16(i * 2, s, true);
		});
		return b;
	};
	it("passes through when rates match", () => {
		const chunk = pcm([1, 2, 3]);
		expect(createPcmResampler(16000, 16000)(chunk)).toBe(chunk);
	});
	it("upsamples 16k→24k at 1.5x across chunk boundaries", () => {
		const r = createPcmResampler(16000, 24000);
		let total = 0;
		for (let i = 0; i < 10; i++)
			total += r(pcm(new Array(1024).fill(100))).byteLength / 2;
		expect(Math.abs(total - 10 * 1024 * 1.5)).toBeLessThanOrEqual(2);
	});
});

describe("resolveWebFile", () => {
	it("serves the device page and assets", () => {
		expect(resolveWebFile("/")).toBe(join(WEB_ROOT, "index.html"));
		expect(resolveWebFile("/avatars/cline/animated-v1/idle.gif")).toBe(
			join(AVATAR_ROOT, "cline/animated-v1/idle.gif"),
		);
	});
	it("serves SDK assets in development and assembled assets in a packaged host", () => {
		const root = mkdtempSync(join(tmpdir(), "device-web-"));
		try {
			expect(resolveWebFile("/avatars/manifest.json", root)).toBe(
				join(AVATAR_ROOT, "manifest.json"),
			);
			cpSync(AVATAR_ROOT, join(root, "avatars"), { recursive: true });
			expect(resolveWebFile("/avatars/manifest.json", root)).toBe(
				join(root, "avatars/manifest.json"),
			);
			expect(resolveWebFile("/avatars/cline/animated-v1/idle.gif", root)).toBe(
				join(root, "avatars/cline/animated-v1/idle.gif"),
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
	it("refuses traversal and missing files", () => {
		expect(resolveWebFile("/../package.json")).toBeUndefined();
		expect(resolveWebFile("/%2e%2e/package.json")).toBeUndefined();
		expect(resolveWebFile("/avatars/../../src/main.ts")).toBeUndefined();
		expect(resolveWebFile("/nope.js")).toBeUndefined();
		expect(resolveWebFile("/%E0%A4%A")).toBeUndefined();
	});
});
