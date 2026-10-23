import { Terminal } from "lucide-react-native";
import { act } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import { brand } from "@/theme/brand";
import { darkSurfaces, radii } from "@/theme/surfaces";
import {
	findAllByType,
	hasStyle,
	render,
	styleValues,
} from "../__testing__/render";
import { fontFamily } from "../theme";
import {
	AutoGrowTextInput,
	BottomSheet,
	Button,
	Card,
	Chip,
	CommandLine,
	Divider,
	IconButton,
	ScreenHeader,
	Spinner,
	StatusDot,
	Surface,
	Text,
	TextField,
} from ".";

const color = darkSurfaces;

describe("Text", () => {
	it("renders the default body tone in the text token color", () => {
		const { root } = render(<Text>hello</Text>);
		expect(hasStyle(root, "color", color.text)).toBe(true);
		expect(hasStyle(root, "fontSize", 14)).toBe(true);
	});

	it("maps muted/accent/danger tones to theme colors", () => {
		expect(
			hasStyle(
				render(<Text tone="muted">m</Text>).root,
				"color",
				color.textMuted,
			),
		).toBe(true);
		expect(
			hasStyle(
				render(<Text tone="accent">a</Text>).root,
				"color",
				brand.violet,
			),
		).toBe(true);
		expect(
			hasStyle(
				render(<Text tone="danger">d</Text>).root,
				"color",
				color.danger,
			),
		).toBe(true);
	});

	it("applies the hero type variant", () => {
		const { root } = render(<Text variant="hero">Hi</Text>);
		expect(hasStyle(root, "fontSize", 32)).toBe(true);
	});
});

describe("Button", () => {
	it("primary fills violet with on-violet label", () => {
		const { root } = render(<Button label="Go" />);
		expect(hasStyle(root, "backgroundColor", brand.primary)).toBe(true);
		expect(hasStyle(root, "color", brand.onPrimary)).toBe(true);
	});

	it("secondary uses the muted surface", () => {
		const { root } = render(<Button label="Go" variant="secondary" />);
		expect(hasStyle(root, "backgroundColor", color.surfaceMuted)).toBe(true);
	});

	it("keeps a native-sized touch target", () => {
		expect(hasStyle(render(<Button label="Go" />).root, "height", 44)).toBe(
			true,
		);
	});

	it("dims when disabled and shows a spinner when loading", () => {
		expect(
			hasStyle(render(<Button label="x" disabled />).root, "opacity", 0.5),
		).toBe(true);
		const loading = render(<Button label="x" loading loadingLabel="Working" />);
		expect(
			loading.root.findAll(
				(node) => node.props.accessibilityRole === "progressbar",
			).length,
		).toBeGreaterThan(0);
	});
});

describe("IconButton", () => {
	it("keeps a native-sized touch target", () => {
		const { root } = render(
			<IconButton accessibilityLabel="Terminal">
				<Terminal size={16} />
			</IconButton>,
		);
		expect(hasStyle(root, "minWidth", 44)).toBe(true);
		expect(hasStyle(root, "minHeight", 44)).toBe(true);
	});
});

describe("Surface / Card", () => {
	it("Card is raised, bordered and padded", () => {
		const { root } = render(
			<Card>
				<Text>c</Text>
			</Card>,
		);
		expect(hasStyle(root, "backgroundColor", color.surfaceRaised)).toBe(true);
		expect(hasStyle(root, "borderWidth", 1)).toBe(true);
	});

	it("Surface honors the muted level", () => {
		const { root } = render(<Surface level="muted" />);
		expect(hasStyle(root, "backgroundColor", color.surfaceMuted)).toBe(true);
	});
});

describe("StatusDot", () => {
	it("colors running green and error red", () => {
		expect(
			hasStyle(
				render(<StatusDot tone="running" />).root,
				"backgroundColor",
				"#22c55e",
			),
		).toBe(true);
		expect(
			hasStyle(
				render(<StatusDot tone="error" />).root,
				"backgroundColor",
				"#ef4444",
			),
		).toBe(true);
	});
});

describe("Chip", () => {
	it("muted chip fills the muted surface", () => {
		const { root } = render(<Chip label="tag" />);
		expect(hasStyle(root, "backgroundColor", color.surfaceMuted)).toBe(true);
	});

	it("accent chip uses the violet subtle fill", () => {
		const { root } = render(<Chip label="tag" tone="accent" />);
		expect(hasStyle(root, "backgroundColor", brand.violetSubtle)).toBe(true);
	});
});

describe("IconButton", () => {
	it("mounts around an icon", () => {
		const { root } = render(
			<IconButton accessibilityLabel="run">
				<Terminal size={16} color={color.textMuted} />
			</IconButton>,
		);
		expect(root).toBeDefined();
	});
});

describe("Spinner", () => {
	it("uses the violet track with a violet live edge", () => {
		const { root } = render(<Spinner />);
		const strokes = findAllByType(root, "Circle").map(
			(node) => node.props.stroke,
		);
		expect(strokes).toContain(brand.violetTrack);
		expect(strokes).toContain(brand.violet);
	});
});

describe("Divider", () => {
	it("paints the border token", () => {
		const { root } = render(<Divider />);
		expect(hasStyle(root, "backgroundColor", color.border)).toBe(true);
	});
});

describe("TextField", () => {
	it("keeps shadow configuration stable when the input gains focus", () => {
		const { root } = render(<TextField />);
		const input = findAllByType(root, "TextInput")[0]!;
		expect(styleValues(root, "shadowColor")).toContain(brand.violet);
		expect(styleValues(root, "shadowOpacity")).toContain(0);
		act(() => input.props.onFocus({}));
		expect(styleValues(root, "shadowColor")).toContain(brand.violet);
		expect(styleValues(root, "shadowOpacity")).toContain(0.2);
		act(() => input.props.onBlur({}));
		expect(styleValues(root, "shadowColor")).toContain(brand.violet);
		expect(styleValues(root, "shadowOpacity")).toContain(0);
	});
	it("outlined variant sits on canvas with a border", () => {
		const { root } = render(<TextField placeholder="Search" />);
		expect(hasStyle(root, "backgroundColor", color.canvas)).toBe(true);
	});

	it("search variant uses the muted surface", () => {
		const { root } = render(
			<TextField variant="search" placeholder="Search" />,
		);
		expect(hasStyle(root, "backgroundColor", color.surfaceMuted)).toBe(true);
	});
});

describe("AutoGrowTextInput", () => {
	it("lets native layout grow wrapped drafts within the composer bounds", () => {
		const { root } = render(
			<AutoGrowTextInput minHeight={44} maxHeight={140} value="A long draft" />,
		);
		expect(styleValues(root, "minHeight")).toContain(44);
		expect(styleValues(root, "maxHeight")).toContain(140);
		expect(styleValues(root, "height")).toHaveLength(0);
	});
	it("mounts with the composer text color", () => {
		const { root } = render(<AutoGrowTextInput placeholder="Ask…" />);
		expect(styleValues(root, "color")).toContain(color.text);
	});

	it("leaves the native text input as the direct touch target", () => {
		const { root } = render(<AutoGrowTextInput placeholder="Ask…" />);
		expect(findAllByType(root, "TextInput")).toHaveLength(1);
		expect(findAllByType(root, "Pressable")).toHaveLength(0);
	});
});

describe("BottomSheet", () => {
	it("keeps sheet contents accessible instead of grouping them into one slider", () => {
		const { root } = render(
			<BottomSheet snapPoints={["50%"]}>
				<Text>sheet</Text>
			</BottomSheet>,
		);
		expect(findAllByType(root, "BottomSheet")[0]?.props.accessible).toBe(false);
		expect(findAllByType(root, "BottomSheet")[0]?.props.topInset).toBe(0);
		expect(
			findAllByType(root, "BottomSheet")[0]?.props.keyboardBlurBehavior,
		).toBe("restore");
		expect(
			findAllByType(root, "BottomSheet")[0]?.props.enableBlurKeyboardOnGesture,
		).toBe(true);
	});
});

describe("CommandLine", () => {
	it("is selectable mono, so long-press → Copy is possible without a clipboard dep", () => {
		const { root } = render(<CommandLine>/handoff</CommandLine>);
		const text = findAllByType(root, "Text").at(-1);
		expect(text?.props.selectable).toBe(true);
		expect(styleValues(root, "fontFamily")).toContain(fontFamily.mono);
	});

	it("names itself as a command for a screen reader", () => {
		const { root } = render(<CommandLine>/handoff</CommandLine>);
		expect(findAllByType(root, "Text").at(-1)?.props.accessibilityLabel).toBe(
			"Command: /handoff",
		);
	});

	it("takes desktop's tightest radius, not a card radius", () => {
		const { root } = render(<CommandLine>/handoff</CommandLine>);
		expect(hasStyle(root, "borderRadius", radii.xs)).toBe(true);
	});
});

describe("ScreenHeader", () => {
	it("paints the sidebar seam: surface fill over a border hairline", () => {
		const { root } = render(<ScreenHeader title="Sessions" />);
		expect(hasStyle(root, "backgroundColor", color.surface)).toBe(true);
		expect(hasStyle(root, "borderBottomColor", color.border)).toBe(true);
	});

	it("titles at the xl step in medium, and announces itself as a header", () => {
		const { root } = render(<ScreenHeader title="Sessions" />);
		const title = findAllByType(root, "Text").at(-1);
		expect(title?.props.accessibilityRole).toBe("header");
		expect(hasStyle(root, "fontSize", 20)).toBe(true);
		// Desktop reserves semibold for hero/markdown headings; chrome is medium.
		expect(hasStyle(root, "fontWeight", "500")).toBe(true);
	});

	it("drops the fill and the hairline when transparent", () => {
		const { root } = render(<ScreenHeader transparent />);
		expect(hasStyle(root, "backgroundColor", color.surface)).toBe(false);
		expect(hasStyle(root, "borderBottomWidth", 1)).toBe(false);
	});

	it("renders the below slot inside the seam", () => {
		const { root } = render(
			<ScreenHeader title="Sessions" below={<Text>search</Text>} />,
		);
		expect(
			findAllByType(root, "Text").some((n) => n.props.children === "search"),
		).toBe(true);
	});
});
