import { act, type ReactTestInstance } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import {
	POLICY_PRESETS,
	summarizeApprovalPolicy,
	TIER_COPY,
} from "@/screens/approval";
import {
	APPROVAL_TIERS,
	type ApprovalPolicy,
	DEFAULT_APPROVAL_POLICY,
} from "@/session";
import { ApprovalPolicyStore } from "@/state/approval-policy-store";
import { SettingsProvider } from "@/state/settings";
import { render } from "../../ui/__testing__/render";
import { containsText, findByLabel, getByLabel } from "../__testing__/harness";
import {
	AutoApproveControl,
	AutoApprovePill,
	AutoApproveSheet,
} from "./AutoApproveControl";

function press(root: ReactTestInstance, label: string): void {
	const node = getByLabel(root, label);
	act(() => {
		node.props.onPress();
	});
}

const ALL_COMBINATIONS: ApprovalPolicy[] = [
	{ read: "ask", write: "ask", execute: "ask" },
	{ read: "auto", write: "ask", execute: "ask" },
	{ read: "ask", write: "auto", execute: "ask" },
	{ read: "auto", write: "auto", execute: "ask" },
	{ read: "ask", write: "ask", execute: "auto" },
	{ read: "auto", write: "ask", execute: "auto" },
	{ read: "ask", write: "auto", execute: "auto" },
	{ read: "auto", write: "auto", execute: "auto" },
];

describe("AutoApprovePill", () => {
	it("renders the summary label for every policy combination", () => {
		for (const policy of ALL_COMBINATIONS) {
			const { root, unmount } = render(
				<AutoApprovePill policy={policy} onPress={() => {}} />,
			);
			expect(containsText(root, summarizeApprovalPolicy(policy).label)).toBe(
				true,
			);
			unmount();
		}
	});

	it("is a button whose accessibility label states the policy in words", () => {
		const { root } = render(
			<AutoApprovePill
				policy={{ read: "auto", write: "ask", execute: "ask" }}
				onPress={() => {}}
			/>,
		);
		const node = root
			.findAll(
				(n) =>
					typeof n.type === "string" &&
					typeof n.props.accessibilityLabel === "string" &&
					n.props.accessibilityLabel.startsWith("Auto-approve:"),
			)
			.at(-1);
		expect(node).toBeDefined();
		expect(node?.props.accessibilityRole).toBe("button");
		expect(node?.props.accessibilityLabel).toContain("read run automatically");
		expect(node?.props.accessibilityHint).toBeTruthy();
	});

	it("keeps a 44pt touch target without overlapping neighboring controls", () => {
		const { root } = render(
			<AutoApprovePill policy={DEFAULT_APPROVAL_POLICY} onPress={() => {}} />,
		);
		const node = root
			.findAll(
				(n) =>
					typeof n.type === "string" &&
					typeof n.props.accessibilityLabel === "string" &&
					n.props.accessibilityLabel.startsWith("Auto-approve:"),
			)
			.at(-1);
		const style = node?.props.style[0];
		expect(style.minHeight).toBeGreaterThanOrEqual(44);
		expect(style.minWidth).toBeGreaterThanOrEqual(44);
	});

	it("fires onPress so the sheet can open", () => {
		const onPress = vi.fn();
		const { root } = render(
			<AutoApprovePill policy={DEFAULT_APPROVAL_POLICY} onPress={onPress} />,
		);
		press(
			root,
			`Auto-approve: ${summarizeApprovalPolicy(DEFAULT_APPROVAL_POLICY).spoken}`,
		);
		expect(onPress).toHaveBeenCalledOnce();
	});
});

describe("AutoApproveSheet", () => {
	function renderSheet(policy = DEFAULT_APPROVAL_POLICY) {
		const onSetTier = vi.fn();
		const onSetPolicy = vi.fn();
		const result = render(
			<AutoApproveSheet
				policy={policy}
				onSetTier={onSetTier}
				onSetPolicy={onSetPolicy}
			/>,
		);
		return { ...result, onSetTier, onSetPolicy };
	}

	it("renders one switch per tier with its risk copy", () => {
		const { root } = renderSheet();
		for (const tier of APPROVAL_TIERS) {
			const copy = TIER_COPY[tier];
			expect(containsText(root, copy.label)).toBe(true);
			expect(containsText(root, copy.risk)).toBe(true);
			expect(findByLabel(root, `Auto-approve ${copy.label}`)).toBeDefined();
		}
	});

	it("reflects each tier's state in its switch", () => {
		const { root } = renderSheet({
			read: "auto",
			write: "ask",
			execute: "ask",
		});
		expect(
			findByLabel(root, "Auto-approve Read files")?.props.accessibilityState
				.checked,
		).toBe(true);
		expect(
			findByLabel(root, "Auto-approve Run commands")?.props.accessibilityState
				.checked,
		).toBe(false);
	});

	it("writes a tier when its switch is flipped", () => {
		const { root, onSetTier } = renderSheet(DEFAULT_APPROVAL_POLICY);
		press(root, "Auto-approve Run commands");
		expect(onSetTier).toHaveBeenCalledWith("execute", "ask");
	});

	it("offers every preset as a button and applies it wholesale", () => {
		const { root, onSetPolicy } = renderSheet();
		for (const preset of POLICY_PRESETS) {
			expect(findByLabel(root, preset.label)).toBeDefined();
			expect(containsText(root, preset.description)).toBe(true);
		}
		press(root, "Auto-approve everything");
		expect(onSetPolicy).toHaveBeenCalledWith({
			read: "auto",
			write: "auto",
			execute: "auto",
		});
	});

	it("marks the preset matching the current policy as current", () => {
		const { root } = renderSheet({
			read: "ask",
			write: "ask",
			execute: "ask",
		});
		expect(containsText(root, "Ask for everything")).toBe(true);
		expect(containsText(root, " · current")).toBe(true);
		expect(
			findByLabel(root, "Ask for everything")?.props.accessibilityState
				?.selected,
		).toBe(true);
	});

	it("states the live-apply promise and unknown tool classification", () => {
		const { root } = renderSheet();
		expect(containsText(root, "Changes apply to this session")).toBe(true);
		expect(containsText(root, "MCP tools")).toBe(true);
	});
});

describe("AutoApproveControl", () => {
	function renderControl(store = new ApprovalPolicyStore()) {
		return {
			store,
			...render(
				<SettingsProvider store={store}>
					<AutoApproveControl />
				</SettingsProvider>,
			),
		};
	}

	it("shows the store's policy on the pill", () => {
		const { root } = renderControl();
		expect(containsText(root, "Auto: all")).toBe(true);
	});

	it("writes a flipped tier through to the shared store", async () => {
		const { root, store } = renderControl();
		press(root, "Auto-approve Edit files");
		await vi.waitFor(() => {
			expect(store.get().write).toBe("ask");
		});
	});

	it("applies a preset through to the shared store", async () => {
		const { root, store } = renderControl();
		press(root, "Ask for everything");
		await vi.waitFor(() => {
			expect(store.get()).toEqual({
				read: "ask",
				write: "ask",
				execute: "ask",
			});
		});
	});

	it("re-labels the pill when the store changes underneath it", async () => {
		const { root, store, renderer } = renderControl();
		expect(containsText(root, "Auto: all")).toBe(true);
		await act(async () => {
			await store.setPolicy({ read: "auto", write: "ask", execute: "ask" });
		});
		expect(containsText(renderer.root, "Auto: read")).toBe(true);
	});
});
