import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

describe("@cline/ui theme integration", () => {
	it("compiles the shared theme and standard Tailwind utilities", async () => {
		const from = fileURLToPath(new URL("./theme-fixture.css", import.meta.url));
		const result = await postcss([tailwindcss()]).process(
			[
				'@import "tailwindcss";',
				'@import "@cline/ui/theme/index.css";',
				'@source inline("bg-background bg-primary-emphasis font-sans text-xs");',
			].join("\n"),
			{ from },
		);

		expect(result.css).toContain("--text-xs: 12px");
		expect(result.css).toContain("--font-weight-normal: 480");
		expect(result.css).toContain('--font-sans: "Schibsted Grotesk Variable"');
		expect(result.css).toContain("--primary-emphasis:");
		expect(result.css).toContain(".bg-background");
		expect(result.css).toContain(".bg-primary-emphasis");
		expect(result.css).toContain(".font-sans");
		expect(result.css).toContain(".text-xs");
		expect(result.css).toContain(
			"letter-spacing: var(--tw-tracking, var(--text-xs--letter-spacing))",
		);
		expect(result.css).not.toContain("--cline-");
	});
});
