import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { findAllByType, render } from "../__testing__/render";
import { AgentWelcomeHero, ClineLogo } from ".";

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
