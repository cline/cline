import { describe, expect, test, vi } from "vitest";
import {
	buildMermaidConfig,
	buildMermaidThemeVariables,
	clampDiagramZoom,
	computeExportScale,
	computePngExportSize,
	createDefaultMermaidConfig,
	createMermaidService,
	cssColorToHex,
	DEFAULT_DIAGRAM_NAME,
	deriveDiagramLabels,
	diagramFileName,
	encodePngWithinLimit,
	FALLBACK_MERMAID_TOKENS,
	INITIAL_DIAGRAM_VIEW,
	MAX_DIAGRAM_SLUG_LENGTH,
	MAX_DIAGRAM_ZOOM,
	MERMAID_FONT_FAMILY,
	type MermaidModuleLoader,
	mixColors,
	normalizeDiagramSource,
	normalizeMermaidTokens,
	PNG_BASE_SCALE,
	PNG_MAX_DESIRED_SCALE,
	PNG_MAX_EDGE,
	PNG_MAX_ENCODED_BYTES,
	parseCssColor,
	parseFenceTitle,
	parseFrontmatterTitle,
	pngFitsAttachmentLimit,
	prepareSvgForRaster,
	resolveDiagramSlug,
	resolveMermaidFontFamily,
	resolvePngDesiredScale,
	slugifyDiagramName,
	splitFrontmatter,
	stepDiagramZoom,
	wheelZoomScale,
	zoomViewAtPoint,
} from "../components/mermaid-diagram";

const FLOW = "flowchart LR\nA --> B";

describe("slugifyDiagramName", () => {
	test("lowercases and keeps only alphanumerics and single hyphens", () => {
		expect(slugifyDiagramName("App Infrastructure_Architecture!")).toBe(
			"app-infrastructure-architecture",
		);
		expect(slugifyDiagramName("  --Hello   World--  ")).toBe("hello-world");
		expect(slugifyDiagramName("Café déjà vu")).toBe("cafe-deja-vu");
		expect(slugifyDiagramName("../../etc/passwd")).toBe("etc-passwd");
	});

	test("returns an empty string when nothing usable remains", () => {
		expect(slugifyDiagramName("")).toBe("");
		expect(slugifyDiagramName("!!! ???")).toBe("");
	});

	test("caps length without leaving a trailing hyphen", () => {
		const slug = slugifyDiagramName(`${"a".repeat(63)} bbbb`);
		expect(slug.length).toBeLessThanOrEqual(MAX_DIAGRAM_SLUG_LENGTH);
		expect(slug.endsWith("-")).toBe(false);
		expect(slugifyDiagramName("x".repeat(500)).length).toBe(
			MAX_DIAGRAM_SLUG_LENGTH,
		);
	});
});

describe("parseFenceTitle", () => {
	test.each([
		[
			'title="app-infrastructure-architecture"',
			"app-infrastructure-architecture",
		],
		["title='Single Quoted'", "Single Quoted"],
		["title=\u201cCurly Quoted\u201d", "Curly Quoted"],
		["title=unquoted-name", "unquoted-name"],
		['title: "colon form"', "colon form"],
		['{1,3} title="with other meta" showLineNumbers', "with other meta"],
		['showLineNumbers title="after flag"', "after flag"],
		['TITLE="Upper"', "Upper"],
	])("reads %s", (meta, expected) => {
		expect(parseFenceTitle(meta)).toBe(expected);
	});

	test("tolerates a title whose closing quote has not streamed in yet", () => {
		expect(parseFenceTitle('title="partial-na')).toBe("partial-na");
	});

	test("returns undefined for missing, empty, or title-less metadata", () => {
		expect(parseFenceTitle(undefined)).toBeUndefined();
		expect(parseFenceTitle(null)).toBeUndefined();
		expect(parseFenceTitle("")).toBeUndefined();
		expect(parseFenceTitle("   ")).toBeUndefined();
		expect(parseFenceTitle('title=""')).toBeUndefined();
		expect(parseFenceTitle("{1,3} showLineNumbers")).toBeUndefined();
		expect(parseFenceTitle('subtitle="nope"')).toBeUndefined();
	});
});

describe("Mermaid parsing regression cases", () => {
	test.each([
		['title=plain title="Quoted"', "Quoted"],
		['title= title="Quoted"', "Quoted"],
		['title="unfinished title=plain', "plain"],
		['title="unfinished title=“curly', "unfinished title=“curly"],
		["title=“unfinished title=“curly", "unfinished title=“curly"],
		['title="" title=plain', undefined],
		['title="unfinished title=“closed”', "closed"],
		["title = \t 'Spaced'", "Spaced"],
	])("preserves title precedence for %s", (meta, expected) => {
		expect(parseFenceTitle(meta)).toBe(expected);
	});

	test("trims frontmatter titles without consuming the next line", () => {
		expect(
			parseFrontmatterTitle(`---\ntitle\t: \t'Auth Flow'\t\r\n---\n${FLOW}`),
		).toBe("Auth Flow");
		expect(
			parseFrontmatterTitle(`---\ntitle: \t\nconfig: dark\n---\n${FLOW}`),
		).toBeUndefined();
		expect(
			parseFrontmatterTitle(`---\ntitle:\ntitle: Second\n---\n${FLOW}`),
		).toBe("Second");
	});

	test("removes multiple and multiline directives without dropping diagram content", () => {
		expect(
			deriveDiagramLabels(
				'%%{init:\n{"theme":"dark"}}%%flowchart LR\n%%{init: {}}%%A[Client] --> B[Server]',
			),
		).toEqual({
			labels: ["Client", "Server"],
			type: "flowchart",
		});
		expect(
			deriveDiagramLabels("flowchart LR\n%%{unfinished\nA[Client]"),
		).toEqual({
			labels: ["Client"],
			type: "flowchart",
		});
	});

	test("preserves interior whitespace and trims Unicode trailing whitespace", () => {
		expect(normalizeDiagramSource(" \tA\tB\u00a0\uFEFF\r\n")).toBe(" \tA\tB\n");
	});

	test("parses padded CSS color arguments and rejects unfinished functions", () => {
		expect(cssColorToHex("rgb( \t255 0 0 \t)")).toBe("#ff0000");
		expect(parseCssColor("rgb( \t255 0 0")).toBeNull();
	});

	test("preserves unrelated SVG styles and removes case-insensitive max-width styles", () => {
		expect(prepareSvgForRaster('<svg style="fill: red"></svg>').svg).toContain(
			'style="fill: red"',
		);
		expect(
			prepareSvgForRaster('<svg STYLE="MAX-WIDTH: 100px; fill: red"></svg>')
				.svg,
		).not.toContain("STYLE=");
		expect(prepareSvgForRaster('<svg style="max-width></svg>').svg).toContain(
			'style="max-width>',
		);
	});

	// CodeQL's adversarial shapes: repeated failed matches must not rescan suffixes.
	test.each([
		[
			"fence titles",
			() => {
				const suffix = "\ttitle:“!".repeat(20_000);
				expect(parseFenceTitle(`\ttitle:"${suffix}`)).toBe(suffix.trim());
			},
		],
		[
			"frontmatter whitespace",
			() => {
				const padding = "\t".repeat(20_000);
				expect(
					parseFrontmatterTitle(`---\ntitle:${padding}\n---\n${FLOW}`),
				).toBeUndefined();
				expect(
					parseFrontmatterTitle(`---\ntitle:a${padding}\n---\n${FLOW}`),
				).toBe("a");
			},
		],
		[
			"unterminated directives",
			() => {
				expect(
					deriveDiagramLabels(`${"%%{{".repeat(20_000)}\n${FLOW}`),
				).toEqual({ labels: [], type: "flowchart" });
			},
		],
		[
			"interior whitespace",
			() => {
				const source = `${"\t".repeat(20_000)}!`;
				expect(normalizeDiagramSource(source)).toBe(`${source}\n`);
			},
		],
		[
			"unfinished CSS functions",
			() => {
				expect(parseCssColor(`-(${"\t".repeat(20_000)}!`)).toBeNull();
			},
		],
		[
			"unterminated SVG styles",
			() => {
				const style = `style="${"max-width".repeat(20_000)}`;
				expect(prepareSvgForRaster(`<svg ${style}></svg>`).svg).toContain(
					style,
				);
			},
		],
	])("processes %s without polynomial backtracking", (_name, check) => {
		const start = performance.now();
		check();
		expect(performance.now() - start).toBeLessThan(1_000);
	});
});

describe("frontmatter", () => {
	test("splits a leading frontmatter block off the diagram body", () => {
		const source = `---\ntitle: Auth Flow\nconfig:\n  theme: dark\n---\n${FLOW}`;
		expect(splitFrontmatter(source)).toEqual({
			body: FLOW,
			frontmatter: "title: Auth Flow\nconfig:\n  theme: dark",
		});
		expect(splitFrontmatter(FLOW)).toEqual({
			body: FLOW,
			frontmatter: undefined,
		});
	});

	test("reads a top-level title, unquoting it, and ignores nested ones", () => {
		expect(parseFrontmatterTitle(`---\ntitle: Auth Flow\n---\n${FLOW}`)).toBe(
			"Auth Flow",
		);
		expect(
			parseFrontmatterTitle(`---\ntitle: "Quoted: Title"\n---\n${FLOW}`),
		).toBe("Quoted: Title");
		expect(
			parseFrontmatterTitle(`---\nconfig:\n  title: nested\n---\n${FLOW}`),
		).toBeUndefined();
		expect(parseFrontmatterTitle(FLOW)).toBeUndefined();
		// An unclosed block (still streaming) is not frontmatter yet.
		expect(parseFrontmatterTitle("---\ntitle: Half")).toBeUndefined();
	});
});

describe("deriveDiagramLabels", () => {
	test("uses the first subgraph then node labels for flowcharts", () => {
		expect(
			deriveDiagramLabels(
				"flowchart TD\n  subgraph VPC\n    GW[API Gateway] --> S[Service]\n  end",
			),
		).toEqual({ labels: ["VPC", "API Gateway"], type: "flowchart" });
		expect(deriveDiagramLabels("graph LR\n  A[Client] --> B{Router}")).toEqual({
			labels: ["Client", "Router"],
			type: "flowchart",
		});
	});

	test("handles quoted subgraph titles and skips directives and comments", () => {
		const source =
			'%%{init: {"theme":"dark"}}%%\n%% a comment\nflowchart LR\n  subgraph sg1 ["Data Plane"]\n    A[Foo]\n  end';
		expect(deriveDiagramLabels(source)).toEqual({
			labels: ["Data Plane", "Foo"],
			type: "flowchart",
		});
	});

	test("names other diagram families", () => {
		expect(
			deriveDiagramLabels(
				"sequenceDiagram\n participant U as User\n participant API\n U->>API: hi",
			),
		).toEqual({ labels: ["User", "API"], type: "sequence" });
		expect(
			deriveDiagramLabels("erDiagram\n CUSTOMER ||--o{ ORDER : places"),
		).toEqual({ labels: ["CUSTOMER", "ORDER"], type: "er" });
		expect(deriveDiagramLabels('pie title Pets\n "Dogs" : 3').type).toBe("pie");
	});

	test("never throws on empty or malformed input", () => {
		expect(deriveDiagramLabels("")).toEqual({ labels: [], type: "" });
		expect(deriveDiagramLabels("flowchart LR\nA --")).toEqual({
			labels: [],
			type: "flowchart",
		});
		expect(() => deriveDiagramLabels("[[[ ((( ---\n%%{")).not.toThrow();
	});
});

describe("resolveDiagramSlug", () => {
	test("prefers the fence title over everything else", () => {
		expect(
			resolveDiagramSlug({
				meta: 'title="app-infrastructure-architecture"',
				source: `---\ntitle: Ignored\n---\n${FLOW}`,
			}),
		).toBe("app-infrastructure-architecture");
	});

	test("falls back to frontmatter, then derived labels, then `diagram`", () => {
		expect(
			resolveDiagramSlug({
				meta: undefined,
				source: `---\ntitle: Auth Flow\n---\n${FLOW}`,
			}),
		).toBe("auth-flow");
		expect(
			resolveDiagramSlug({
				meta: "",
				source:
					"flowchart TD\n  subgraph VPC\n    GW[API Gateway] --> S[Service]\n  end",
			}),
		).toBe("flowchart-vpc-api-gateway");
		expect(resolveDiagramSlug({ source: "" })).toBe(DEFAULT_DIAGRAM_NAME);
	});

	test("skips a fence title that slugifies to nothing", () => {
		expect(resolveDiagramSlug({ meta: 'title="!!!"', source: FLOW })).toBe(
			"flowchart",
		);
	});

	test("keeps derived names short", () => {
		const long = `flowchart LR\n  subgraph ${"Very".repeat(30)}\n  end`;
		expect(resolveDiagramSlug({ source: long }).length).toBeLessThanOrEqual(48);
	});
});

describe("diagram file helpers", () => {
	test("builds .mmd and .png names", () => {
		expect(diagramFileName("my-diagram", "mmd")).toBe("my-diagram.mmd");
		expect(diagramFileName("my-diagram", "png")).toBe("my-diagram.png");
		expect(diagramFileName("", "png")).toBe("diagram.png");
	});

	test("normalizes trailing whitespace to a single newline", () => {
		expect(normalizeDiagramSource("a --> b\n\n  \n")).toBe("a --> b\n");
	});
});

describe("color conversion", () => {
	test.each([
		["oklch(1 0 0)", "#ffffff"],
		["oklch(0 0 0)", "#000000"],
		["oklch(0.5 0 0)", "#636363"],
		// sRGB primaries expressed in oklch round-trip exactly.
		["oklch(0.628 0.2577 29.23)", "#ff0000"],
		["oklch(0.452 0.313 264.05)", "#0000ff"],
		["oklch(0.55 0.22 293)", "#7c49e3"],
		["oklch(55% 0.22 293deg)", "#7c49e3"],
		["#6e56cf", "#6e56cf"],
		["#FFF", "#ffffff"],
		["rgb(110, 86, 207)", "#6e56cf"],
		["rgb(110 86 207 / 50%)", "#6e56cf"],
		["rgba(110,86,207,0.5)", "#6e56cf"],
		["color(srgb 1 0.5 0)", "#ff8000"],
	])("%s -> %s", (input, expected) => {
		expect(cssColorToHex(input)).toBe(expected);
	});

	test("clamps out-of-gamut oklch to valid sRGB", () => {
		expect(cssColorToHex("oklch(0.7 0.5 150)")).toMatch(/^#[\da-f]{6}$/);
	});

	test("keeps alpha for callers that need it", () => {
		expect(parseCssColor("rgb(0 0 0 / 25%)")?.a).toBeCloseTo(0.25);
		expect(parseCssColor("rgba(0,0,0,.5)")?.a).toBeCloseTo(0.5);
		expect(parseCssColor("#00000080")?.a).toBeCloseTo(0.5, 1);
	});

	test.each([
		"",
		"var(--card)",
		"color-mix(in srgb, red 50%, blue)",
		"color(display-p3 1 0 0)",
		"not-a-color",
		"oklch(0.5 foo 10)",
	])("rejects %j so callers can fall back", (input) => {
		expect(cssColorToHex(input)).toBeNull();
	});

	test("mixes colors in sRGB and tolerates unparseable input", () => {
		expect(mixColors("#000000", "#ffffff", 0.5)).toBe("#808080");
		expect(mixColors("#101010", "#ffffff", 0)).toBe("#101010");
		expect(mixColors("#101010", "#ffffff", 1)).toBe("#ffffff");
		expect(mixColors("#101010", "var(--x)", 0.5)).toBe("#101010");
		expect(mixColors("var(--x)", "#ffffff", 0.5)).toBe("var(--x)");
	});
});

const HEX = /^#[\da-f]{6}$/;

describe("Mermaid theme", () => {
	test("normalizes oklch tokens to hex and falls back per token", () => {
		const tokens = normalizeMermaidTokens(
			{
				...FALLBACK_MERMAID_TOKENS.light,
				background: "oklch(0.985 0 0)",
				primary: "oklch(0.55 0.22 293)",
				border: "var(--border)",
			},
			"light",
		);
		expect(tokens.primary).toBe("#7c49e3");
		expect(tokens.background).toMatch(HEX);
		expect(tokens.border).toBe(FALLBACK_MERMAID_TOKENS.light.border);
	});

	test.each([
		"light",
		"dark",
	] as const)("builds concrete hex theme variables for %s mode", (mode) => {
		const vars = buildMermaidThemeVariables(
			FALLBACK_MERMAID_TOKENS[mode],
			mode,
		);
		for (const [key, value] of Object.entries(vars)) {
			if (key === "darkMode" || key === "fontFamily" || key === "fontSize") {
				continue;
			}
			// Mermaid tints with khroma and the SVG is rasterized in an <img>:
			// every color must be concrete, never var(--x) / oklch().
			expect(value, key).toMatch(HEX);
		}
		expect(vars.darkMode).toBe(mode === "dark");
		expect(vars.background).toBe(FALLBACK_MERMAID_TOKENS[mode].background);
		expect(vars.textColor).toBe(FALLBACK_MERMAID_TOKENS[mode].foreground);
		expect(vars.lineColor).toBe(FALLBACK_MERMAID_TOKENS[mode].mutedForeground);
	});

	test("differs between light and dark and follows the accent", () => {
		const light = buildMermaidThemeVariables(
			FALLBACK_MERMAID_TOKENS.light,
			"light",
		);
		const dark = buildMermaidThemeVariables(
			FALLBACK_MERMAID_TOKENS.dark,
			"dark",
		);
		expect(light.primaryColor).not.toBe(dark.primaryColor);

		const cyan = buildMermaidThemeVariables(
			{ ...FALLBACK_MERMAID_TOKENS.light, primary: "oklch(0.6 0.12 222)" },
			"light",
		);
		expect(cyan.primaryColor).not.toBe(light.primaryColor);
		expect(cyan.primaryBorderColor).not.toBe(light.primaryBorderColor);
	});

	test("uses an Inter-first, non-monospace font stack", () => {
		expect(MERMAID_FONT_FAMILY.toLowerCase()).toContain("inter");
		expect(MERMAID_FONT_FAMILY.trim().toLowerCase()).not.toBe("monospace");
		expect(
			buildMermaidThemeVariables(FALLBACK_MERMAID_TOKENS.light, "light")
				.fontFamily,
		).toBe(MERMAID_FONT_FAMILY);
	});

	test("asks the injected resolver to resolve every token value", () => {
		const seen: string[] = [];
		const tokens = {
			background: "var(--card)",
			border: "var(--border)",
			error: "var(--destructive)",
			foreground: "var(--foreground)",
			muted: "var(--muted)",
			mutedForeground: "var(--muted-foreground)",
			primary: "var(--primary)",
		};
		const vars = buildMermaidThemeVariables(tokens, "dark", {
			resolveColor: (value) => {
				seen.push(value);
				return value === "var(--card)" ? "rgb(1, 2, 3)" : null;
			},
		});
		expect(new Set(seen)).toEqual(new Set(Object.values(tokens)));
		// Resolver output is normalized to hex; unresolved tokens use the palette.
		expect(vars.background).toBe("#010203");
		expect(vars.textColor).toBe(FALLBACK_MERMAID_TOKENS.dark.foreground);
	});

	test("honors a custom fontFamily and light/dark backgrounds differ", () => {
		const config = buildMermaidConfig(FALLBACK_MERMAID_TOKENS.light, "light", {
			fontFamily: "Georgia, serif",
		});
		expect(config.fontFamily).toBe("Georgia, serif");
		expect(config.themeVariables?.fontFamily).toBe("Georgia, serif");
		const dark = buildMermaidConfig(FALLBACK_MERMAID_TOKENS.dark, "dark");
		expect(dark.themeVariables?.background).not.toBe(
			config.themeVariables?.background,
		);
		for (const value of Object.values(dark.themeVariables ?? {})) {
			expect(["string", "boolean"]).toContain(typeof value);
		}
	});

	test("derives the font stack from --font-sans, never monospace", () => {
		expect(resolveMermaidFontFamily('"Inter Variable", sans-serif')).toBe(
			`'Inter Variable', sans-serif, ${MERMAID_FONT_FAMILY}`,
		);
		expect(resolveMermaidFontFamily("")).toBe(MERMAID_FONT_FAMILY);
		expect(resolveMermaidFontFamily(undefined)).toBe(MERMAID_FONT_FAMILY);
		expect(resolveMermaidFontFamily("ui-monospace, monospace")).toBe(
			MERMAID_FONT_FAMILY,
		);
		expect(resolveMermaidFontFamily('"A", serif')).not.toContain('"');
	});

	test("config uses the base theme, strict security, and SVG-text labels", () => {
		const config = buildMermaidConfig(FALLBACK_MERMAID_TOKENS.dark, "dark");
		expect(config).toMatchObject({
			fontFamily: MERMAID_FONT_FAMILY,
			// foreignObject labels taint canvases and break PNG export.
			htmlLabels: false,
			securityLevel: "strict",
			startOnLoad: false,
			suppressErrorRendering: true,
			theme: "base",
		});
		expect(config.themeVariables?.darkMode).toBe(true);
		// No per-node overrides: user init/classDef/style must win in Mermaid.
		expect(config).not.toHaveProperty("flowchart");
		expect(config).not.toHaveProperty("themeCSS");
	});

	test("default config is the light base theme", () => {
		expect(createDefaultMermaidConfig()).toEqual(
			buildMermaidConfig(FALLBACK_MERMAID_TOKENS.light, "light"),
		);
		expect(createDefaultMermaidConfig("dark").theme).toBe("base");
	});
});

describe("zoom", () => {
	test("clamps and steps within bounds, returning exactly to 1", () => {
		expect(clampDiagramZoom(100)).toBe(MAX_DIAGRAM_ZOOM);
		expect(clampDiagramZoom(0)).toBeGreaterThan(0);
		expect(clampDiagramZoom(Number.NaN)).toBe(1);
		expect(stepDiagramZoom(stepDiagramZoom(1, "in"), "out")).toBe(1);
		expect(stepDiagramZoom(MAX_DIAGRAM_ZOOM, "in")).toBe(MAX_DIAGRAM_ZOOM);
	});

	test("keeps the point under the cursor fixed while zooming", () => {
		const point = { x: 100, y: 50 };
		const before = { scale: 1, x: 10, y: 20 };
		const after = zoomViewAtPoint(before, 2, point);
		// content coordinate under the point = (point - translate) / scale
		expect((point.x - after.x) / after.scale).toBeCloseTo(
			(point.x - before.x) / before.scale,
		);
		expect((point.y - after.y) / after.scale).toBeCloseTo(
			(point.y - before.y) / before.scale,
		);
		expect(zoomViewAtPoint(INITIAL_DIAGRAM_VIEW, 999, point).scale).toBe(
			MAX_DIAGRAM_ZOOM,
		);
	});

	test("wheel zoom is bounded and direction-correct", () => {
		expect(wheelZoomScale(1, -100)).toBeGreaterThan(1);
		expect(wheelZoomScale(1, 100)).toBeLessThan(1);
		expect(wheelZoomScale(1, 100000)).toBeCloseTo(wheelZoomScale(1, 100));
	});
});

describe("resolvePngDesiredScale", () => {
	test("never goes below the 2x base, even on 1x displays", () => {
		expect(resolvePngDesiredScale(1)).toBe(PNG_BASE_SCALE);
		expect(resolvePngDesiredScale(0.5)).toBe(PNG_BASE_SCALE);
	});

	test("follows the device pixel ratio up to the max", () => {
		expect(resolvePngDesiredScale(2)).toBe(2);
		expect(resolvePngDesiredScale(2.5)).toBe(3);
		expect(resolvePngDesiredScale(3)).toBe(3);
		expect(resolvePngDesiredScale(5)).toBe(PNG_MAX_DESIRED_SCALE);
	});

	test("falls back to the base scale for missing or invalid ratios", () => {
		expect(resolvePngDesiredScale()).toBe(PNG_BASE_SCALE);
		expect(resolvePngDesiredScale(null)).toBe(PNG_BASE_SCALE);
		expect(resolvePngDesiredScale(Number.NaN)).toBe(PNG_BASE_SCALE);
		expect(resolvePngDesiredScale(Number.POSITIVE_INFINITY)).toBe(
			PNG_BASE_SCALE,
		);
	});
});

describe("computeExportScale", () => {
	test("keeps the base scale for small diagrams instead of Streamdown's 5x", () => {
		expect(computeExportScale({ height: 200, width: 300 })).toBe(
			PNG_BASE_SCALE,
		);
		expect(computeExportScale({ height: 200, width: 300 }, 3)).toBe(3);
	});

	test("caps huge diagrams so the longest edge is at most the max", () => {
		const size = { height: 3000, width: 9000 };
		const scale = computeExportScale(size);
		expect(scale).toBeCloseTo(PNG_MAX_EDGE / 9000);
		expect(Math.max(size.width, size.height) * scale).toBeLessThanOrEqual(
			PNG_MAX_EDGE + 1e-9,
		);
		expect(computeExportScale({ height: 1000, width: 1000 }, 5, 2000)).toBe(2);
	});

	test("never returns NaN or Infinity for degenerate sizes", () => {
		for (const size of [
			{ height: 0, width: 0 },
			{ height: Number.NaN, width: Number.POSITIVE_INFINITY },
			{ height: -5, width: -1 },
		]) {
			const scale = computeExportScale(size);
			expect(Number.isFinite(scale), JSON.stringify(size)).toBe(true);
			expect(scale).toBeGreaterThan(0);
		}
	});
});

describe("computePngExportSize", () => {
	test("uses the desired scale for small diagrams", () => {
		expect(computePngExportSize({ height: 600, width: 800 })).toEqual({
			height: 1200,
			scale: 2,
			width: 1600,
		});
		expect(computePngExportSize({ height: 600, width: 800 }, 3)).toEqual({
			height: 1800,
			scale: 3,
			width: 2400,
		});
	});

	test("caps the longest edge at ~4096px", () => {
		const size = computePngExportSize({ height: 500, width: 3000 }, 3);
		expect(size.width).toBe(PNG_MAX_EDGE);
		expect(size.height).toBe(683);
		expect(size.scale).toBeCloseTo(4096 / 3000);
		const tall = computePngExportSize({ height: 3000, width: 400 });
		expect(tall.height).toBeLessThanOrEqual(PNG_MAX_EDGE);
	});

	test("shrinks a diagram that is already past the cap so the edge never exceeds it", () => {
		const wide = computePngExportSize({ height: 100, width: 8192 });
		expect(wide.width).toBe(PNG_MAX_EDGE);
		expect(wide.scale).toBeCloseTo(0.5);
		expect(wide.height).toBe(50);
		const tall = computePngExportSize({ height: 6807, width: 259 });
		expect(tall.height).toBe(PNG_MAX_EDGE);
		expect(tall.scale).toBeLessThan(1);
		expect(tall.width).toBeGreaterThanOrEqual(1);
	});

	test("never exceeds the cap on either edge for any input size", () => {
		for (const [width, height] of [
			[1, 1],
			[300, 200],
			[1365, 900],
			[4096, 10],
			[5000, 5000],
			[20000, 30],
		] as const) {
			const size = computePngExportSize({ height, width });
			expect(size.width).toBeLessThanOrEqual(PNG_MAX_EDGE);
			expect(size.height).toBeLessThanOrEqual(PNG_MAX_EDGE);
		}
	});

	test("tolerates degenerate sizes", () => {
		const size = computePngExportSize({ height: 0, width: Number.NaN });
		expect(size.width).toBeGreaterThanOrEqual(1);
		expect(size.height).toBeGreaterThanOrEqual(1);
	});
});

describe("encodePngWithinLimit", () => {
	const OVERSIZE = PNG_MAX_ENCODED_BYTES; // base64 pushes this past the cap

	test("accounts for base64 expansion when checking the attachment limit", () => {
		expect(pngFitsAttachmentLimit(1024)).toBe(true);
		expect(pngFitsAttachmentLimit(3 * 1024 * 1024)).toBe(true);
		expect(pngFitsAttachmentLimit(4 * 1024 * 1024)).toBe(false);
		expect(pngFitsAttachmentLimit(OVERSIZE)).toBe(false);
	});

	test("encodes once at the desired scale when the PNG already fits", async () => {
		const encode = vi.fn(async () => ({ size: 1000 }));
		await encodePngWithinLimit({ height: 600, width: 800 }, encode);
		expect(encode).toHaveBeenCalledTimes(1);
		expect(encode).toHaveBeenCalledWith({
			height: 1200,
			scale: 2,
			width: 1600,
		});
	});

	test("starts from a custom initial scale (device pixel ratio)", async () => {
		const encode = vi.fn(async () => ({ size: 1000 }));
		await encodePngWithinLimit({ height: 600, width: 800 }, encode, 3);
		expect(encode).toHaveBeenCalledOnce();
		expect(encode).toHaveBeenCalledWith({
			height: 1800,
			scale: 3,
			width: 2400,
		});
	});

	test("retries at a lower scale until the PNG fits, never below 1x", async () => {
		const scales: number[] = [];
		const result = await encodePngWithinLimit(
			{ height: 600, width: 800 },
			async (size) => {
				scales.push(size.scale);
				return { size: size.scale > 1.5 ? OVERSIZE : 1000 };
			},
		);
		expect(result.size).toBe(1000);
		expect(scales[0]).toBe(PNG_BASE_SCALE);
		expect(scales.length).toBeGreaterThan(1);
		expect(scales.at(-1)).toBeLessThanOrEqual(1.5);
		expect(Math.min(...scales)).toBeGreaterThanOrEqual(1);
		// Strictly decreasing, so retries always make progress.
		scales.forEach((scale, index) => {
			if (index > 0) expect(scale).toBeLessThan(scales[index - 1] ?? 0);
		});
	});

	test("stops at 1x and returns the smallest attempt when nothing fits", async () => {
		const scales: number[] = [];
		const result = await encodePngWithinLimit(
			{ height: 600, width: 800 },
			async (size) => {
				scales.push(size.scale);
				return { scale: size.scale, size: OVERSIZE };
			},
		);
		expect(scales.at(-1)).toBe(1);
		expect(result.scale).toBe(1);
		expect(scales.length).toBeLessThanOrEqual(4);
	});

	test("does not retry when the edge cap already forced the scale below 1x", async () => {
		const encode = vi.fn(async () => ({ size: OVERSIZE }));
		await encodePngWithinLimit({ height: 100, width: 8192 }, encode);
		expect(encode).toHaveBeenCalledTimes(1);
	});

	test("propagates encoder failures", async () => {
		await expect(
			encodePngWithinLimit({ height: 10, width: 10 }, async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
	});
});

describe("prepareSvgForRaster", () => {
	test("gives a 100%-wide Mermaid SVG the intrinsic viewBox size", () => {
		const prepared = prepareSvgForRaster(
			'<svg id="m" width="100%" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150" style="max-width: 300px;"><g/></svg>',
		);
		expect(prepared.width).toBe(300);
		expect(prepared.height).toBe(150);
		expect(prepared.svg).toContain('width="300"');
		expect(prepared.svg).toContain('height="150"');
		expect(prepared.svg).not.toContain("100%");
		expect(prepared.svg).not.toContain("max-width");
	});

	test("adds missing namespaces and makes HTML entities XML-safe", () => {
		const prepared = prepareSvgForRaster(
			'<svg viewBox="0 0 10 10"><text>a&nbsp;b</text><use xlink:href="#x"/><br></svg>',
		);
		expect(prepared.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
		expect(prepared.svg).toContain(
			'xmlns:xlink="http://www.w3.org/1999/xlink"',
		);
		expect(prepared.svg).toContain("a&#160;b");
		expect(prepared.svg).toContain("<br/>");
	});

	test("falls back to a default size without a viewBox or root tag", () => {
		expect(prepareSvgForRaster("<div/>").width).toBeGreaterThan(0);
		expect(
			prepareSvgForRaster('<svg width="120" height="80"></svg>'),
		).toMatchObject({ height: 80, width: 120 });
	});
});

describe("createMermaidService", () => {
	function renderer() {
		return {
			initialize: vi.fn(),
			render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"/>` })),
		};
	}

	test("does not import Mermaid until the first render", async () => {
		const mermaid = renderer();
		const loader = vi.fn<MermaidModuleLoader>(async () => ({
			default: mermaid,
		}));
		const service = createMermaidService(loader);
		expect(loader).not.toHaveBeenCalled();
		const config = createDefaultMermaidConfig();
		await service.render("a", FLOW, config);
		await service.render("b", FLOW, config);
		expect(loader).toHaveBeenCalledTimes(1);
		expect(mermaid.initialize).toHaveBeenCalledTimes(1);
		expect(mermaid.initialize).toHaveBeenCalledWith(config);
	});

	test("re-initializes only when the theme config changes", async () => {
		const mermaid = renderer();
		const service = createMermaidService(async () => ({ default: mermaid }));
		const light = createDefaultMermaidConfig("light");
		const dark = createDefaultMermaidConfig("dark");
		await service.render("a", FLOW, light);
		await service.render("b", FLOW, dark);
		await service.render("c", FLOW, dark);
		expect(mermaid.initialize).toHaveBeenCalledTimes(2);
		expect(mermaid.initialize).toHaveBeenLastCalledWith(dark);
	});

	test("retries the import after a chunk load failure", async () => {
		const mermaid = renderer();
		const error = new Error("chunk unavailable");
		const loader = vi
			.fn<MermaidModuleLoader>()
			.mockRejectedValueOnce(error)
			.mockResolvedValueOnce({ default: mermaid });
		const service = createMermaidService(loader);
		const config = createDefaultMermaidConfig();
		await expect(service.render("a", FLOW, config)).rejects.toBe(error);
		await expect(service.render("b", FLOW, config)).resolves.toEqual({
			svg: '<svg id="b"/>',
		});
		expect(loader).toHaveBeenCalledTimes(2);
	});

	// The owned block injects this SVG itself, bypassing the Streamdown diagram
	// plugin, so the service is the one place link neutralization can live.
	test("neutralizes diagram links in the rendered SVG", async () => {
		const mermaid = {
			initialize: vi.fn(),
			render: vi.fn(async () => ({
				svg: '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="https://evil.example.com/" target="_blank"><text>Docs</text></a><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
			})),
		};
		const service = createMermaidService(async () => ({ default: mermaid }));
		const { svg } = await service.render(
			"a",
			FLOW,
			createDefaultMermaidConfig(),
		);
		expect(svg).not.toMatch(/\s(?:xlink:)?href\s*=/);
		expect(svg).not.toMatch(/\starget\s*=/);
		expect(svg).toContain(
			'data-cline-diagram-href="https://evil.example.com/"',
		);
		expect(svg).not.toContain("javascript:");
	});
});
