import { describe, expect, it, vi } from "vitest";
import { getSyntaxStyle } from "./syntax-style";

const { MockRGBA, MockSyntaxStyle } = vi.hoisted(() => {
	class MockRGBA {
		private constructor(private readonly hex: string) {}

		static fromHex(hex: string): MockRGBA {
			return new MockRGBA(hex.toLowerCase());
		}

		toInts(): [number, number, number, number] {
			return [
				Number.parseInt(this.hex.slice(1, 3), 16),
				Number.parseInt(this.hex.slice(3, 5), 16),
				Number.parseInt(this.hex.slice(5, 7), 16),
				255,
			];
		}
	}

	class MockSyntaxStyle {
		private constructor(private readonly styles: Map<string, unknown>) {}

		static fromStyles(styles: Record<string, unknown>): MockSyntaxStyle {
			return new MockSyntaxStyle(new Map(Object.entries(styles)));
		}

		getStyle(name: string): unknown {
			return this.styles.get(name);
		}
	}

	return { MockRGBA, MockSyntaxStyle };
});

vi.mock("@opentui/core", () => ({
	RGBA: MockRGBA,
	SyntaxStyle: MockSyntaxStyle,
}));

describe("getSyntaxStyle", () => {
	it("keeps dark markdown prose on the terminal default foreground", () => {
		expect(getSyntaxStyle("dark").getStyle("default")).toBeUndefined();
	});

	it("uses a dark default foreground for light markdown content", () => {
		const style = getSyntaxStyle("light").getStyle("default");

		expect(style?.fg?.toInts()).toEqual([26, 26, 26, 255]);
	});

	it("tints markdown accents by mode", () => {
		// act #79b8ff vs plan #ffea7f (dark theme accents)
		expect(
			getSyntaxStyle("dark", "act").getStyle("markup.heading")?.fg?.toInts(),
		).toEqual([0x79, 0xb8, 0xff, 255]);
		expect(
			getSyntaxStyle("dark", "plan").getStyle("markup.heading")?.fg?.toInts(),
		).toEqual([0xff, 0xea, 0x7f, 255]);
		expect(
			getSyntaxStyle("dark", "plan").getStyle("markup.link")?.fg?.toInts(),
		).toEqual([0xff, 0xea, 0x7f, 255]);
	});

	it("tints light-theme markdown accents by mode", () => {
		// act #0f72cb vs plan #867100 (light theme accents)
		expect(
			getSyntaxStyle("light", "act").getStyle("markup.heading")?.fg?.toInts(),
		).toEqual([0x0f, 0x72, 0xcb, 255]);
		expect(
			getSyntaxStyle("light", "plan").getStyle("markup.heading")?.fg?.toInts(),
		).toEqual([0x86, 0x71, 0x00, 255]);
	});

	it("keeps code token colors constant across modes", () => {
		expect(getSyntaxStyle("dark", "plan").getStyle("keyword")).toEqual(
			getSyntaxStyle("dark", "act").getStyle("keyword"),
		);
	});
});
