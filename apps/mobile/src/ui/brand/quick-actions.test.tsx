/**
 * `QuickActions` is the RN port of desktop's `AgentQuickActions`, so these tests
 * pin the geometry and the accent behavior that make it read as that component:
 * one bordered group, hairlines only BETWEEN rows, and a violet affordance that
 * inverts on press (desktop's hover inversion).
 */

import { describe, expect, it } from "vitest";
import { brand } from "@/theme/brand";
import { darkSurfaces, radii } from "@/theme/surfaces";
import { findAllByType, hasStyle, render } from "../__testing__/render";
import { flattenStyle } from "../__testing__/rn-host";
import { QuickAction, QuickActions } from "./QuickActions";

describe("QuickActions group", () => {
	it("is one bordered card at radius-xl with a softened hairline", () => {
		const { root } = render(
			<QuickActions>
				<QuickAction label="Sign in to Cline" onPress={() => {}} />
			</QuickActions>,
		);
		// radius-xl (12) is `radius.lg` on the RN scale.
		expect(hasStyle(root, "borderRadius", radii.lg)).toBe(true);
		// Desktop border at 60% opacity.
		expect(hasStyle(root, "borderColor", "rgba(47, 47, 55, 0.6)")).toBe(true);
	});

	it("draws hairlines between rows and never after the last", () => {
		const one = render(
			<QuickActions>
				<QuickAction label="A" onPress={() => {}} />
			</QuickActions>,
		);
		const three = render(
			<QuickActions>
				<QuickAction label="A" onPress={() => {}} />
				<QuickAction label="B" onPress={() => {}} />
				<QuickAction label="C" onPress={() => {}} />
			</QuickActions>,
		);
		// Divider renders a 1pt-tall host View; count those, not the composite
		// wrappers, so each rule is counted once.
		const rules = (r: ReturnType<typeof render>) =>
			findAllByType(r.root, "View").filter(
				(node) => flattenStyle(node.props.style).height === 1,
			).length;
		expect(rules(one)).toBe(0);
		expect(rules(three)).toBe(2);
	});

	it("drops the nulls a conditional row leaves behind", () => {
		const showFirst: boolean = false;
		const { root } = render(
			<QuickActions>
				{showFirst ? <QuickAction label="hidden" /> : null}
				<QuickAction label="Only me" onPress={() => {}} />
			</QuickActions>,
		);
		// One row, so no divider was drawn for the absent sibling.
		expect(
			findAllByType(root, "View").filter(
				(node) => flattenStyle(node.props.style).height === 1,
			),
		).toHaveLength(0);
	});
});

describe("QuickAction row", () => {
	it("is a labelled button with a violet-tinted affordance at rest", () => {
		const { root } = render(
			<QuickActions>
				<QuickAction
					label="Sign in to Cline"
					description="Run agents in Cline Cloud."
					accessibilityHint="Opens your browser"
					onPress={() => {}}
				/>
			</QuickActions>,
		);
		const pressable = findAllByType(root, "Pressable")[0];
		expect(pressable?.props.accessibilityRole).toBe("button");
		expect(pressable?.props.accessibilityLabel).toBe("Sign in to Cline");
		expect(pressable?.props.accessibilityHint).toBe("Opens your browser");
		// primary@10% fill with a primary glyph.
		expect(hasStyle(root, "backgroundColor", brand.violetSubtle)).toBe(true);
		expect(
			findAllByType(root, "icon").some((i) => i.props.color === brand.violet),
		).toBe(true);
	});

	it("keeps a 44pt target even though desktop rows are single-line", () => {
		const { root } = render(
			<QuickActions>
				<QuickAction label="Sign in" onPress={() => {}} />
			</QuickActions>,
		);
		expect(hasStyle(root, "minHeight", 44)).toBe(true);
	});

	it("renders detail content inside the row, in reading order", () => {
		const { root } = render(
			<QuickActions>
				<QuickAction
					label="Connect this computer"
					description="Run this in Cline."
					detail={<QuickAction label="/handoff" />}
				/>
			</QuickActions>,
		);
		const text = root
			.findAll(() => true, { deep: true })
			.flatMap((n) =>
				typeof n.props.children === "string" ? [n.props.children] : [],
			)
			.join(" ");
		expect(text.indexOf("Connect this computer")).toBeLessThan(
			text.indexOf("/handoff"),
		);
	});

	it("renders an informational row with no button role and no affordance", () => {
		const { root } = render(
			<QuickActions>
				<QuickAction
					label="Connect this computer"
					description="Run /handoff."
				/>
			</QuickActions>,
		);
		expect(findAllByType(root, "Pressable")).toHaveLength(0);
		expect(hasStyle(root, "backgroundColor", brand.violetSubtle)).toBe(false);
	});

	it("marks a disabled row busy rather than pressable-looking", () => {
		const { root } = render(
			<QuickActions>
				<QuickAction label="Sign in" disabled onPress={() => {}} />
			</QuickActions>,
		);
		// `disabled` with an `onPress` degrades to the informational row: nothing to
		// press, so no arrow inviting a press.
		expect(findAllByType(root, "Pressable")).toHaveLength(0);
	});

	it("names the group for assistive tech when asked", () => {
		const { root } = render(
			<QuickActions accessibilityLabel="Ways to get a session">
				<QuickAction label="A" onPress={() => {}} />
			</QuickActions>,
		);
		const group = root.findAll(
			(node) =>
				typeof node.type === "string" &&
				node.props.accessibilityLabel === "Ways to get a session",
		);
		expect(group.length).toBeGreaterThan(0);
		expect(group[0]?.props.accessibilityRole).toBe("menu");
	});

	it("sits on the raised surface, not the canvas", () => {
		const { root } = render(
			<QuickActions>
				<QuickAction label="A" onPress={() => {}} />
			</QuickActions>,
		);
		// background@95% of `--card`.
		const raised = darkSurfaces.surfaceRaised
			.slice(1)
			.match(/.{2}/g)
			?.map((b) => Number.parseInt(b, 16))
			.join(", ");
		expect(hasStyle(root, "backgroundColor", `rgba(${raised}, 0.95)`)).toBe(
			true,
		);
	});
});
