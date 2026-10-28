import { Buffer } from "node:buffer";
import { expect, it } from "vitest";
import { utf8ToBase64 } from "./utf8-base64";

it.each([
	"",
	"a",
	"ab",
	"abc",
	"SGVsbG8=",
	"Résumé 🐈\nこんにちは",
	"\ud800",
	"文".repeat(25_000),
])("encodes authored file bytes with standard UTF-8/base64 semantics %#", (text) => {
	expect(utf8ToBase64(text)).toBe(Buffer.from(text, "utf8").toString("base64"));
});

it("preserves a larger Unicode document across output chunk boundaries", () => {
	const text = "Résumé — 日本語 🚀\n".repeat(8192);
	expect(utf8ToBase64(text)).toBe(Buffer.from(text, "utf8").toString("base64"));
});
