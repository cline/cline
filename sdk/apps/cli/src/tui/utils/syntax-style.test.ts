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
});
