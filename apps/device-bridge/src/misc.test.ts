import { describe, expect, it } from "bun:test";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildResponse, parseQuestions, readName } from "./mdns";
import { DeviceRegistry } from "./pairing";
import { parseDeviceMessage } from "./protocol";
import { resolveWebFile, WEB_ROOT } from "./server";
import { createPcmResampler } from "./transcribe";
import { pcmToWav } from "./wav";

describe("parseDeviceMessage", () => {
	it("accepts valid commands and rejects junk", () => {
		expect(parseDeviceMessage('{"t":"approve","id":"a1"}')).toEqual({
			t: "approve",
			id: "a1",
		});
		expect(parseDeviceMessage('{"t":"approve"}')).toBeUndefined();
		expect(parseDeviceMessage('{"t":"nope"}')).toBeUndefined();
		expect(parseDeviceMessage("not json")).toBeUndefined();
		expect(
			parseDeviceMessage(`{"t":"abort","x":"${"a".repeat(2000)}"}`),
		).toBeUndefined();
	});
});

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
	const file = () => join(mkdtempSync(join(tmpdir(), "pet-")), "devices.json");

	it("pairs once with a valid code and authenticates the token", () => {
		const path = file();
		const reg = new DeviceRegistry(path);
		const { code } = reg.issueCode();
		expect(
			reg.pair("000000" === code ? "111111" : "000000", "pet"),
		).toBeUndefined();
		const token = reg.pair(code, "pet");
		expect(token).toBeString();
		expect(reg.pair(code, "pet")).toBeUndefined(); // single use
		expect(new DeviceRegistry(path).authenticate(token as string)?.name).toBe(
			"pet",
		);
		expect(reg.authenticate("bogus")).toBeUndefined();
		expect(statSync(path).mode & 0o777).toBe(0o600);
	});

	it("expires codes and locks out brute force", () => {
		let now = 0;
		const reg = new DeviceRegistry(file(), () => now);
		const { code } = reg.issueCode();
		now += 6 * 60_000;
		expect(reg.pair(code, "pet")).toBeUndefined();
		const fresh = reg.issueCode().code;
		const wrong = fresh === "999999" ? "000000" : "999999";
		for (let i = 0; i < 5; i++) reg.pair(wrong, "pet");
		expect(reg.pair(fresh, "pet")).toBeUndefined();
	});
});

describe("mdns", () => {
	it("answers with PTR/SRV/TXT/A records that round-trip names", () => {
		const res = buildResponse(
			{ instance: "Cline Pet Bridge", port: 25470, txt: { v: "1" } },
			"laptop",
			["192.168.1.5"],
		);
		expect(res.readUInt16BE(6)).toBe(4);
		expect(readName(res, 12)[0]).toBe("_clinepet._tcp.local");
		expect(res.includes(Buffer.from([192, 168, 1, 5]))).toBe(true);
	});

	it("parses questions from a query and ignores responses", () => {
		const q = Buffer.concat([
			Buffer.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]),
			Buffer.from([
				9,
				...Buffer.from("_clinepet"),
				4,
				...Buffer.from("_tcp"),
				5,
				...Buffer.from("local"),
				0,
			]),
			Buffer.from([0, 12, 0, 1]),
		]);
		expect(parseQuestions(q)).toEqual([
			{ name: "_clinepet._tcp.local", type: 12 },
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
	it("serves the pet page and assets", () => {
		expect(resolveWebFile("/")).toBe(join(WEB_ROOT, "index.html"));
		expect(resolveWebFile("/pets/cline/idle.gif")).toBe(
			join(WEB_ROOT, "pets/cline/idle.gif"),
		);
	});
	it("refuses traversal and missing files", () => {
		expect(resolveWebFile("/../package.json")).toBeUndefined();
		expect(resolveWebFile("/%2e%2e/package.json")).toBeUndefined();
		expect(resolveWebFile("/pets/../../src/main.ts")).toBeUndefined();
		expect(resolveWebFile("/nope.js")).toBeUndefined();
		expect(resolveWebFile("/%E0%A4%A")).toBeUndefined();
	});
});
