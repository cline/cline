import { describe, expect, it } from "vitest";
import zhCN from "./strings/zh-CN";
import {
	interpolate,
	normalizeSource,
	registerStrings,
	stringsFor,
	translateWith,
} from "./translate";

describe("i18n translate", () => {
	it("returns the source text when nothing matches", () => {
		expect(translateWith("en", "Dark mode")).toBe("Dark mode");
		expect(translateWith("xx", "Dark mode")).toBe("Dark mode");
		// The failure mode has to be English, never a breadcrumb or an empty node.
		expect(translateWith("zh-CN", "A string nobody translated yet")).toBe(
			"A string nobody translated yet",
		);
	});

	it("looks up the English source as the key", () => {
		registerStrings("test", { "Dark mode": "深色模式" });
		expect(translateWith("test", "Dark mode")).toBe("深色模式");
		expect(stringsFor("test")?.["Dark mode"]).toBe("深色模式");
	});

	it("tolerates the whitespace JSX collapses differently", () => {
		registerStrings("test2", {
			"Keep the desktop interface in dark mode.": "保持深色。",
		});
		expect(
			translateWith("test2", "Keep  the\tdesktop interface in dark mode."),
		).toBe("保持深色。");
		expect(normalizeSource(" a \n b ")).toBe("a b");
	});

	it("interpolates named slots and leaves unknown ones visible", () => {
		registerStrings("test3", {
			"{count} sessions": "{count} 個會話",
			"{used} of {total} credits": "{used} / {total} 點數",
		});
		expect(translateWith("test3", "{count} sessions", { count: 3 })).toBe(
			"3 個會話",
		);
		// A dropped word reads worse than a stray placeholder: an unsupplied slot
		// stays as written instead of collapsing to an empty string.
		expect(translateWith("test3", "{count} sessions")).toBe("{count} 個會話");
		expect(
			translateWith("test3", "{used} of {total} credits", { used: 4 }),
		).toBe("4 / {total} 點數");
		expect(interpolate("no slots")).toBe("no slots");
	});

	it("ships every registered locale with real coverage", () => {
		// Guards the mistake of adding a locale file that is an empty stub.
		expect(Object.keys(zhCN).length).toBeGreaterThan(400);
		for (const code of ["zh-CN", "zh-TW", "ja", "ko", "vi"]) {
			const table = stringsFor(code);
			expect(table, code).toBeTruthy();
			expect(Object.keys(table ?? {}).length, code).toBeGreaterThan(400);
		}
	});

	it("translates a string that is actually on the settings screen", () => {
		expect(translateWith("zh-CN", "Dark mode")).toBe("深色模式");
		expect(translateWith("ja", "Dark mode")).toBe("ダークモード");
		expect(translateWith("ko", "Dark mode")).toBe("다크 모드");
	});
});
