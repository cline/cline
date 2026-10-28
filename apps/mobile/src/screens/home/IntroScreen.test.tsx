import { useState } from "react";
import * as ReactNative from "react-native";
import { Keyboard, Platform, StyleSheet } from "react-native";
import * as KeyboardController from "react-native-keyboard-controller";
import { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { Text } from "@/ui";
import { findAllByType, render } from "@/ui/__testing__/render";
import { containsText } from "../__testing__/harness";
import { HomeComposer } from "./HomeComposer";
import { IntroScreen } from "./IntroScreen";

function mount() {
	return render(
		<IntroScreen
			contextControl={<Text>workspace-context</Text>}
			composer={<Text>persistent-composer</Text>}
		/>,
	);
}

describe("IntroScreen", () => {
	it("replaces the composer with setup without remounting its local draft", () => {
		let showSetup!: (visible: boolean) => void;
		function Draft() {
			const [value, setValue] = useState("");
			return <ReactNative.TextInput value={value} onChangeText={setValue} />;
		}
		function Harness() {
			const [setup, setSetup] = useState(false);
			showSetup = setSetup;
			return (
				<IntroScreen
					contextControl={<Text>workspace-context</Text>}
					composer={<Draft />}
					setup={setup ? <Text>Connect GitHub</Text> : undefined}
				/>
			);
		}
		const mounted = render(<Harness />);
		const input = findAllByType(mounted.root, "TextInput")[0]!;
		act(() => input.props.onChangeText("Keep this draft"));
		act(() => showSetup(true));
		expect(containsText(mounted.root, "Connect GitHub")).toBe(true);
		const composerContainer = mounted.root.find(
			(node) =>
				typeof node.type === "string" &&
				StyleSheet.flatten(node.props.style)?.display === "none" &&
				node.findAll((child) => child === input).length > 0,
		);
		expect(composerContainer.props.collapsable).toBe(false);
		act(() => showSetup(false));
		expect(
			mounted.root.find(
				(node) =>
					typeof node.type === "string" &&
					node.props.testID === "intro-composer-boundary",
			),
		).toBe(composerContainer);
		expect(findAllByType(mounted.root, "TextInput")[0]).toBe(input);
		expect(input.props.value).toBe("Keep this draft");
		expect(StyleSheet.flatten(composerContainer.props.style).display).toBe(
			"flex",
		);
		mounted.unmount();
	});

	it("keeps the landscape draft editable and submits it once", () => {
		const dimensions = vi
			.spyOn(ReactNative, "useWindowDimensions")
			.mockReturnValue({ width: 874, height: 402, scale: 3, fontScale: 1 });
		const onSend = vi.fn();
		function Harness() {
			const [draft, setDraft] = useState("Landscape draft");
			return (
				<IntroScreen
					contextControl={<Text>workspace-context</Text>}
					composer={
						<HomeComposer
							draft={draft}
							onDraftChange={setDraft}
							onSend={onSend}
							target={{
								id: "local",
								mode: "local",
								title: "Mac",
								detail: "Computer",
								descriptor: { mode: "local", url: "ws://localhost:4599/hub" },
							}}
						/>
					}
				/>
			);
		}
		const mounted = render(<Harness />);
		try {
			const input = findAllByType(mounted.root, "TextInput")[0]!;
			expect(StyleSheet.flatten(input.props.style)).toMatchObject({
				minHeight: 44,
				maxHeight: 60,
			});
			act(() => input.props.onChangeText("Still editable above keyboard"));
			expect(input.props.value).toBe("Still editable above keyboard");
			act(() =>
				mounted.root
					.find((node) => node.props.accessibilityLabel === "Send to Mac")
					.props.onPress(),
			);
			expect(onSend).toHaveBeenCalledTimes(1);
			expect(onSend).toHaveBeenCalledWith(
				"Still editable above keyboard",
				undefined,
			);
			expect(
				mounted.root.findAll(
					(node) => node.props.testID === "agent-welcome-hero",
				),
			).toHaveLength(0);
		} finally {
			mounted.unmount();
			dimensions.mockRestore();
		}
	});

	it.each([
		"ios",
		"android",
	] as const)("explicitly avoids the %s keyboard", (os) => {
		const previousOS = Platform.OS;
		Platform.OS = os;
		try {
			const mounted = mount();
			expect(
				findAllByType(mounted.root, "KeyboardAvoidingView")[0]?.props.behavior,
			).toBe("padding");
			mounted.unmount();
		} finally {
			Platform.OS = previousOS;
		}
	});
	it("keeps the Cline welcome hierarchy", () => {
		const { root } = mount();
		expect(
			root.findAll((node) => node.props.testID === "agent-welcome-hero").at(0),
		).toBeDefined();
		expect(containsText(root, "workspace-context")).toBe(true);
		expect(containsText(root, "persistent-composer")).toBe(true);
	});
	it.each([
		0, 0.5, 1,
	])("keeps the portrait welcome logo visible at keyboard progress %s", (progress) => {
		const animation = KeyboardController.useReanimatedKeyboardAnimation();
		animation.progress.value = progress;
		const keyboard = vi
			.spyOn(KeyboardController, "useReanimatedKeyboardAnimation")
			.mockReturnValue(animation);
		const mounted = mount();
		try {
			const hero = mounted.root.find(
				(node) =>
					typeof node.type === "string" &&
					node.props.testID === "agent-welcome-hero",
			);
			expect(StyleSheet.flatten(hero.props.style).height).toBe(160);
			const ancestors = mounted.root.findAll(
				(node) => node.findAll((child) => child === hero).length > 0,
			);
			for (const ancestor of ancestors) {
				const style = StyleSheet.flatten(ancestor.props.style) ?? {};
				expect(style.opacity ?? 1).toBe(1);
				expect(style.height).not.toBe(0);
			}
		} finally {
			mounted.unmount();
			keyboard.mockRestore();
		}
	});

	it("contains contextual notices in the welcome group", () => {
		const { root } = render(
			<IntroScreen
				contextControl={<Text>workspace-context</Text>}
				notice={<Text>account-notice</Text>}
				composer={<Text>persistent-composer</Text>}
			/>,
		);
		expect(containsText(root, "account-notice")).toBe(true);
	});

	it("keeps the decorative hero out of the accessibility tree", () => {
		const { root } = mount();
		const headings = root.findAll(
			(node) =>
				typeof node.type === "string" &&
				node.props.accessibilityRole === "header",
		);
		expect(headings).toHaveLength(1);
		expect(headings[0]?.props.accessibilityLabel).toBe(
			"What would you like to build?",
		);

		const hero = root
			.findAll((node) => node.props.testID === "agent-welcome-hero")
			.at(0);
		expect(hero).toBeDefined();
		expect(hero?.props.accessibilityElementsHidden).toBe(true);
		expect(hero?.props.importantForAccessibility).toBe("no-hide-descendants");
	});

	it("groups the welcome content with one keyboard avoidance owner", () => {
		const { root } = mount();
		expect(
			findAllByType(root, "ScrollView").at(0)?.props.contentContainerStyle,
		).toMatchObject({
			flexGrow: 1,
			justifyContent: "center",
			paddingHorizontal: 16,
			paddingTop: 8,
			paddingBottom: 8,
		});
		expect(
			findAllByType(root, "ScrollView").at(0)?.props
				.automaticallyAdjustKeyboardInsets,
		).not.toBe(true);
		expect(findAllByType(root, "KeyboardAvoidingView")).toHaveLength(1);
		expect(findAllByType(root, "RadialGradient")).toHaveLength(1);
		expect(
			root.findAll((node) => node.props.testID === "agent-welcome-grid").at(0),
		).toBeDefined();
	});

	it("contains no first-run connection UI after configuration", () => {
		const { root } = mount();
		expect(containsText(root, "/handoff")).toBe(false);
		expect(containsText(root, "Sign in to Cline")).toBe(false);
		expect(findAllByType(root, "TextInput")).toHaveLength(0);
	});

	it("hides landscape work context while typing without unmounting the composer", () => {
		const dimensions = vi
			.spyOn(ReactNative, "useWindowDimensions")
			.mockReturnValue({ width: 874, height: 402, scale: 3, fontScale: 1 });
		const listeners = new Map<string, () => void>();
		const addListener = Keyboard.addListener;
		const spy = vi
			.spyOn(Keyboard, "addListener")
			.mockImplementation((event, callback) => {
				listeners.set(event, callback as () => void);
				return addListener(event, callback);
			});
		const mounted = mount();
		try {
			const context = mounted.root.find(
				(node) =>
					typeof node.type === "string" &&
					node.props.children?.props?.children === "workspace-context",
			);
			act(() => listeners.get("keyboardWillShow")?.());
			expect(StyleSheet.flatten(context.props.style).display).toBe("none");
			expect(containsText(mounted.root, "persistent-composer")).toBe(true);
			expect(
				mounted.root.findAll(
					(node) => node.props.testID === "agent-welcome-hero",
				),
			).toHaveLength(0);
			expect(
				findAllByType(mounted.root, "ScrollView")[0]?.props
					.contentContainerStyle.paddingBottom,
			).toBe(8);
			act(() => listeners.get("keyboardWillHide")?.());
			expect(StyleSheet.flatten(context.props.style).display).toBe("flex");
			expect(
				mounted.root.findAll(
					(node) => node.props.testID === "agent-welcome-hero",
				).length,
			).toBe(0);
		} finally {
			mounted.unmount();
			spy.mockRestore();
			dimensions.mockRestore();
		}
	});
});
