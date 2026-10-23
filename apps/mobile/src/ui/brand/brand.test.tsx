import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { brand } from "@/theme/brand";
import {
	cleanup,
	findAllByType,
	hasStyle,
	render,
	setReducedMotion,
	styleValues,
} from "../__testing__/render";
import { flattenStyle } from "../__testing__/rn-host";
import { typography } from "../theme/typography";
import {
	AgentWelcomeHero,
	AuroraBackground,
	ClineLogo,
	HERO_CYCLE_MS,
	HERO_ENTER_MS,
	HERO_SENTENCE,
	HERO_STAGGER_MS,
	HERO_VERBS,
	HeroHeading,
} from ".";

describe("AgentWelcomeHero", () => {
	it("uses the desktop bot geometry and force-dark visual layers", () => {
		const { root } = render(<AgentWelcomeHero />);
		const grid = findAllByType(root, "Stop").at(0);
		expect(grid?.props.stopColor).toBe("#dbd9ff");
		expect(grid?.props.stopOpacity).toBe(0.2);

		const inner = root
			.findAll((node) => node.props.testID === "agent-welcome-bot-inner")
			.at(0);
		expect(inner?.props.fill).toBe("#d9ceff");
		expect(inner?.props.fillOpacity).toBe(0.06);

		const fill = root
			.findAll((node) => node.props.testID === "agent-welcome-bot-fill")
			.at(0);
		expect(fill).toBeDefined();
		expect(fill?.props.fill).toBe("#d9ceff");
		expect(fill?.props.fillOpacity).toBe(0.13);
		expect(fill?.props.d).toContain("M118.894 28.2461");

		const outline = root
			.findAll((node) => node.props.testID === "agent-welcome-bot-outline")
			.at(0);
		expect(outline?.props.stroke).toBe("#d9ceff");
		expect(outline?.props.strokeOpacity).toBe(0.12);

		const eyes = findAllByType(root, "Rect");
		expect(eyes).toHaveLength(2);
		for (const eye of eyes) {
			expect(eye.props.fill).toBe("#d9ceff");
			expect(eye.props.fillOpacity).toBe(0.13);
			expect(eye.props.stroke).toBe("#d9ceff");
			expect(eye.props.strokeOpacity).toBe(0.12);
		}
	});

	it("moves both eyes toward the latest touch target", async () => {
		const { withTiming } = await import("react-native-reanimated");
		vi.mocked(withTiming).mockClear();
		const rendered = render(<AgentWelcomeHero />);
		act(() => {
			rendered.renderer.update(
				<AgentWelcomeHero eyeOffset={{ x: 4, y: -2 }} />,
			);
		});
		expect(vi.mocked(withTiming)).toHaveBeenCalledWith(
			4,
			expect.objectContaining({ duration: 140 }),
		);
		expect(vi.mocked(withTiming)).toHaveBeenCalledWith(
			-2,
			expect.objectContaining({ duration: 140 }),
		);
	});

	it("can split the desktop grid and bot into separate visual layers", () => {
		const grid = render(<AgentWelcomeHero variant="grid-only" />).root;
		expect(
			grid.findAll((node) => node.props.testID === "agent-welcome-grid"),
		).not.toHaveLength(0);
		expect(
			grid.findAll((node) => node.props.testID === "agent-welcome-bot-fill"),
		).toHaveLength(0);

		const bot = render(<AgentWelcomeHero variant="bot-only" />).root;
		expect(
			bot.findAll((node) => node.props.testID === "agent-welcome-grid"),
		).toHaveLength(0);
		expect(
			bot.findAll((node) => node.props.testID === "agent-welcome-bot-fill"),
		).not.toHaveLength(0);
	});
});

describe("ClineLogo", () => {
	it("matches the canonical desktop branding geometry and given color", () => {
		const { root } = render(<ClineLogo color="#fafafa" />);
		const canonical = readFileSync(
			new URL(
				"../../../../../assets/branding/logos/cline-icon-white.svg",
				import.meta.url,
			),
			"utf8",
		);
		const paths = findAllByType(root, "Path");
		expect(paths.length).toBe(1);
		expect(paths.every((path) => path.props.fill === "#fafafa")).toBe(true);
		expect(paths[0]?.props.d).toBe(canonical.match(/<path d="([^"]+)"/)?.[1]);
		expect(findAllByType(root, "Svg")[0]?.props.viewBox).toBe(
			canonical.match(/viewBox="([^"]+)"/)?.[1],
		);
		const eyes = [
			...canonical.matchAll(
				/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" rx="([^"]+)"/g,
			),
		];
		expect(
			findAllByType(root, "Rect").map(({ props }) => ({
				x: props.x,
				y: props.y,
				width: props.width,
				height: props.height,
				rx: props.rx,
				fill: props.fill,
			})),
		).toEqual(
			eyes.map(([, x, y, width, height, rx]) => ({
				x: Number(x),
				y: Number(y),
				width: Number(width),
				height: Number(height),
				rx: Number(rx),
				fill: "#fafafa",
			})),
		);
	});
});

/**
 * Every string the hero paints, in tree order, with the layout's no-break spaces
 * normalized back to the plain spaces a reader sees.
 */
function visibleSentence(root: Parameters<typeof styleValues>[0]): string {
	return root
		.findAll((node) => typeof node.type === "string", { deep: true })
		.map((node) => node.props.children)
		.filter((child): child is string => typeof child === "string")
		.join("")
		.replaceAll(" ", " ");
}

/** The characters clipped to a gradient, in order. */
function gradientCharacters(root: Parameters<typeof styleValues>[0]): string {
	return findAllByType(root, "LinearGradient")
		.flatMap((gradient) =>
			gradient.findAll((node) => typeof node.type === "string", { deep: true }),
		)
		.map((node) => node.props.children)
		.filter((child): child is string => typeof child === "string")
		.join("");
}

/** The `<Text>` painting `needle`, wherever it sits in the tree. */
function textNodeFor(root: Parameters<typeof styleValues>[0], needle: string) {
	return root
		.findAll(
			(node) => typeof node.type === "string" && node.props.children === needle,
		)
		.at(0);
}

describe("HeroHeading", () => {
	afterEach(() => {
		cleanup();
		setReducedMotion(false);
		vi.useRealTimers();
	});

	it("asks the desktop's question, verbatim", () => {
		const { root } = render(<HeroHeading />);
		expect(visibleSentence(root)).toBe("What would you like to build?");
	});

	it("keeps the gradient verb inline mid-sentence, and only the verb", () => {
		const { root } = render(<HeroHeading />);
		// The verb, not the lead and not the "?".
		expect(gradientCharacters(root)).toBe("build");
		// One flow, not a lead line and a gradient line: the sentence is a single
		// wrapping row, so nothing forces a line break before the verb.
		expect(hasStyle(root, "flexWrap", "wrap")).toBe(true);
	});

	it("clips the gradient per character, not once across the word", () => {
		const { root } = render(<HeroHeading />);
		// css:23 hangs `background-image` on `…__character`, and sets no
		// `background-size`, so every glyph box carries the whole ramp.
		expect(findAllByType(root, "MaskedView")).toHaveLength("build".length);
		expect(findAllByType(root, "LinearGradient")).toHaveLength("build".length);
	});

	it("uses the brand hero ramp at the CSS's 135deg and 55% stop", () => {
		const { root } = render(<HeroHeading />);
		for (const gradient of findAllByType(root, "LinearGradient")) {
			// periwinkle → violet 55% → magenta (css:24-29).
			expect(gradient.props.colors).toEqual(brand.heroGradient);
			expect(gradient.props.locations).toEqual([0, 0.55, 1]);
			// 135deg is clockwise from "to top", i.e. top-left → bottom-right.
			expect(gradient.props.start).toEqual({ x: 0, y: 0 });
			expect(gradient.props.end).toEqual({ x: 1, y: 1 });
		}
	});

	it("leaves the question mark in --foreground, outside the gradient", () => {
		const { root } = render(<HeroHeading />);
		expect(gradientCharacters(root)).not.toContain("?");
		// Same color as the lead words, which never enter a gradient.
		const question = textNodeFor(root, "?");
		expect(question).toBeDefined();
		expect(flattenStyle(question?.props.style).color).toBe(
			flattenStyle(textNodeFor(root, "What ")?.props.style).color,
		);
		expect(flattenStyle(question?.props.style).color).not.toBe(brand.violet);
	});

	it("cycles through every verb, 2600ms apart", () => {
		vi.useFakeTimers();
		const { root } = render(<HeroHeading />);
		const seen = [visibleSentence(root)];
		for (let step = 0; step < HERO_VERBS.length; step += 1) {
			act(() => {
				vi.advanceTimersByTime(HERO_CYCLE_MS);
			});
			seen.push(visibleSentence(root));
		}
		for (const verb of HERO_VERBS) {
			expect(seen).toContain(`What would you like to ${verb}?`);
		}
		// And it comes back around rather than stopping on the last verb.
		expect(seen.at(-1)).toBe(seen[0]);
	});

	it("staggers each character of the verb by 45ms", async () => {
		const { withDelay } = await import("react-native-reanimated");
		vi.mocked(withDelay).mockClear();
		render(<HeroHeading />);
		const delays = vi.mocked(withDelay).mock.calls.map((call) => call[0]);
		expect(delays).toEqual(
			[..."build"].map((_character, index) => index * HERO_STAGGER_MS),
		);
	});

	it("eases the entrance on the desktop's curve and duration", async () => {
		const { withTiming } = await import("react-native-reanimated");
		vi.mocked(withTiming).mockClear();
		render(<HeroHeading />);
		// The mocked `Easing.bezier` echoes its control points back.
		expect(vi.mocked(withTiming).mock.calls[0]?.[1]).toEqual({
			duration: HERO_ENTER_MS,
			easing: [0.2, 0.65, 0.3, 1],
		});
	});

	it("pins the verb and skips the entrance under reduced motion", () => {
		setReducedMotion(true);
		vi.useFakeTimers();
		const { root } = render(<HeroHeading />);
		act(() => {
			vi.advanceTimersByTime(HERO_CYCLE_MS * 5);
		});
		expect(visibleSentence(root)).toBe("What would you like to build?");
		// Settled, not mid-animation: fully opaque and at its resting offset.
		expect(styleValues(root, "opacity")).not.toContain(0);
		expect(styleValues(root, "transform")).toContainEqual([{ translateY: 0 }]);
	});

	it("speaks one stable sentence and hides the mutating verb from AT", () => {
		vi.useFakeTimers();
		const { root } = render(<HeroHeading />);
		const heading = root
			.findAll((node) => node.props.accessibilityRole === "header")
			.at(0);
		expect(heading?.props.accessibilityLabel).toBe(HERO_SENTENCE);
		expect(HERO_SENTENCE).toBe("What would you like to build?");
		// The label must not follow the verb, or a screen reader re-announces it.
		act(() => {
			vi.advanceTimersByTime(HERO_CYCLE_MS);
		});
		expect(heading?.props.accessibilityLabel).toBe(HERO_SENTENCE);
		expect(
			root.findAll((node) => node.props.accessibilityElementsHidden === true),
		).not.toHaveLength(0);
	});

	it("sets the hero type metrics on every part of the sentence", () => {
		const { root } = render(<HeroHeading />);
		// clamp() floor 32, line-height 1.12, -0.025em, semibold.
		expect(typography.hero).toMatchObject({
			fontSize: 32,
			lineHeight: 35.84,
			letterSpacing: -0.8,
			fontWeight: "600",
		});
		const sizes = styleValues(root, "fontSize");
		expect(sizes).not.toHaveLength(0);
		expect(new Set(sizes)).toEqual(new Set([32]));
	});
});

describe("AuroraBackground", () => {
	it("mounts the radial blobs and horizon band", () => {
		const { root } = render(<AuroraBackground />);
		expect(findAllByType(root, "RadialGradient").length).toBe(2);
		expect(findAllByType(root, "LinearGradient").length).toBeGreaterThan(0);
	});
});
