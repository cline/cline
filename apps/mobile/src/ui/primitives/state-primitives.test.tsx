/**
 * Render tests for the state/feedback primitives added for the Chat screen:
 * `Banner`, `IconBadge`, `StateView`, `Disclosure`, `CodeBlock`, and
 * `Chip`'s pressable form. Same shape as `primitives.test.tsx` — mount in Node
 * and assert on flattened token colors plus the accessibility contract.
 */

import { Terminal } from "lucide-react-native";
import { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { brand } from "@/theme/brand";
import { darkSurfaces } from "@/theme/surfaces";
import { hasStyle, render, styleValues } from "../__testing__/render";
import { feedback } from "../theme";
import {
	Banner,
	Chip,
	CodeBlock,
	Disclosure,
	IconBadge,
	StateView,
	Text,
} from ".";

const color = darkSurfaces;

/** Every accessibility label in the tree. */
function labels(root: Parameters<typeof styleValues>[0]): unknown[] {
	return root
		.findAll(() => true, { deep: true })
		.map((node) => node.props.accessibilityLabel)
		.filter((value) => value !== undefined);
}

describe("Banner", () => {
	it("fills with the tone's subtle color and hairlines with its border", () => {
		const { root } = render(<Banner tone="warning" message="heads up" />);
		expect(hasStyle(root, "backgroundColor", feedback.warning.subtle)).toBe(
			true,
		);
		expect(hasStyle(root, "borderBottomColor", feedback.warning.border)).toBe(
			true,
		);
		expect(hasStyle(root, "color", feedback.warning.fg)).toBe(true);
	});

	it("becomes a labelled button with a 44pt row when pressable", () => {
		const onPress = vi.fn();
		const { root } = render(
			<Banner
				tone="warning"
				message="2 approvals waiting"
				accessibilityLabel="Review pending approvals"
				onPress={onPress}
			/>,
		);
		const button = root.find(
			(node) =>
				typeof node.type === "string" &&
				node.props.accessibilityLabel === "Review pending approvals",
		);
		expect(button.props.accessibilityRole).toBe("button");
		expect(hasStyle(root, "minHeight", 44)).toBe(true);
		act(() => {
			button.props.onPress();
		});
		expect(onPress).toHaveBeenCalledTimes(1);
	});

	it("renders a pulsing progress hairline in the tone color", () => {
		const { root } = render(
			<Banner tone="info" message="Reconnecting…" pulse />,
		);
		// The bottom rule is painted solid in `fg`; only its opacity animates.
		expect(hasStyle(root, "backgroundColor", feedback.info.fg)).toBe(true);
	});
});

describe("IconBadge", () => {
	it("tints with the violet subtle fill by default", () => {
		const { root } = render(
			<IconBadge>
				<Terminal size={16} />
			</IconBadge>,
		);
		expect(hasStyle(root, "backgroundColor", brand.violetSubtle)).toBe(true);
	});

	it("uses the feedback family for semantic tones and can ring itself", () => {
		const { root } = render(
			<IconBadge tone="danger" size={56} bordered>
				<Terminal size={24} />
			</IconBadge>,
		);
		expect(hasStyle(root, "backgroundColor", feedback.danger.subtle)).toBe(
			true,
		);
		expect(hasStyle(root, "borderColor", feedback.danger.border)).toBe(true);
		expect(hasStyle(root, "width", 56)).toBe(true);
	});
});

describe("StateView", () => {
	it("centers a medallion, headline, body, actions and footer", () => {
		const { root } = render(
			<StateView
				tone="danger"
				icon={<Terminal size={24} />}
				headline="Can't reach that hub"
				body="Nothing answered at that address."
				footer={<Text>details</Text>}
			>
				<Text>action</Text>
			</StateView>,
		);
		expect(hasStyle(root, "justifyContent", "center")).toBe(true);
		// Headline takes the `lg 18/26` heading step so it out-ranks the body.
		expect(hasStyle(root, "fontSize", 18)).toBe(true);
		expect(hasStyle(root, "backgroundColor", feedback.danger.subtle)).toBe(
			true,
		);
	});

	it("renders a bare icon without a medallion when asked", () => {
		const { root } = render(
			<StateView bareIcon icon={<Terminal size={40} />} headline="Ready" />,
		);
		expect(hasStyle(root, "backgroundColor", brand.violetSubtle)).toBe(false);
	});
});

describe("Disclosure", () => {
	it("exposes an expand/collapse button and hides content until opened", () => {
		const { root } = render(
			<Disclosure label="Details">
				<Text>secret</Text>
			</Disclosure>,
		);
		const trigger = root.find(
			(node) => node.props.accessibilityRole === "button",
		);
		expect(trigger.props.accessibilityLabel).toBe("Details, expand");
		expect(trigger.props.accessibilityState).toEqual({ expanded: false });

		act(() => {
			trigger.props.onPress();
		});
		const opened = root.find(
			(node) => node.props.accessibilityRole === "button",
		);
		expect(opened.props.accessibilityLabel).toBe("Details, collapse");
		expect(opened.props.accessibilityState).toEqual({ expanded: true });
	});

	it("uses the subject label for assistive tech, not the visible one", () => {
		const { root } = render(
			<Disclosure label="ls -la" accessibilityLabel="Tool ls -la" />,
		);
		expect(labels(root)).toContain("Tool ls -la, expand");
	});

	it("rail variant draws a left hairline instead of a box", () => {
		const { root } = render(
			<Disclosure label="Reasoning" variant="rail" defaultExpanded>
				<Text>thought</Text>
			</Disclosure>,
		);
		expect(hasStyle(root, "borderLeftWidth", 1)).toBe(true);
		expect(hasStyle(root, "borderLeftColor", color.border)).toBe(true);
	});

	it("inset variant indents content under the trigger label", () => {
		const { root } = render(
			<Disclosure label="Tool" variant="inset" indent={32} defaultExpanded>
				<Text>output</Text>
			</Disclosure>,
		);
		expect(hasStyle(root, "paddingLeft", 32)).toBe(true);
	});

	it("supports controlled expansion", () => {
		const onToggle = vi.fn();
		const { root } = render(
			<Disclosure label="Details" expanded onToggle={onToggle}>
				<Text>shown</Text>
			</Disclosure>,
		);
		const trigger = root.find(
			(node) => node.props.accessibilityRole === "button",
		);
		act(() => {
			trigger.props.onPress();
		});
		expect(onToggle).toHaveBeenCalledWith(false);
		// Still expanded — the parent owns the state.
		expect(
			root.find((node) => node.props.accessibilityRole === "button").props
				.accessibilityState,
		).toEqual({ expanded: true });
	});
});

describe("CodeBlock", () => {
	it("renders mono text in a capped, bordered panel", () => {
		const { root } = render(<CodeBlock maxHeight={160}>$ ls -la</CodeBlock>);
		expect(hasStyle(root, "maxHeight", 160)).toBe(true);
		expect(hasStyle(root, "borderWidth", 1)).toBe(true);
		expect(styleValues(root, "fontFamily")).toContain("AzeretMono");
	});

	it("wraps instead of nesting a horizontal scroller when asked", () => {
		const wrapped = render(<CodeBlock wrap>long line</CodeBlock>);
		const scrollers = wrapped.root.findAll(
			(node) => node.props.horizontal === true,
		);
		expect(scrollers).toEqual([]);
	});
});

describe("Chip (pressable)", () => {
	it("becomes a labelled button with an extended hit area", () => {
		const onPress = vi.fn();
		const { root } = render(
			<Chip
				label="Explain what this project does"
				size="md"
				pill
				accessibilityLabel="Use example prompt: Explain what this project does"
				onPress={onPress}
			/>,
		);
		const button = root.find(
			(node) => node.props.accessibilityRole === "button",
		);
		expect(button.props.accessibilityLabel).toBe(
			"Use example prompt: Explain what this project does",
		);
		expect(button.props.hitSlop).toEqual({
			top: 8,
			bottom: 8,
			left: 4,
			right: 4,
		});
		expect(hasStyle(root, "borderRadius", 999)).toBe(true);
		act(() => {
			button.props.onPress();
		});
		expect(onPress).toHaveBeenCalledTimes(1);
	});

	it("stays a plain View when it has no press handler", () => {
		const { root } = render(<Chip label="Idle" />);
		expect(
			root.findAll((node) => node.props.accessibilityRole === "button"),
		).toEqual([]);
	});
});
