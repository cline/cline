import { describe, expect, it } from "vitest";
import {
	APPROVAL_TIERS,
	type ApprovalPolicy,
	DEFAULT_APPROVAL_POLICY,
} from "@/session";
import {
	matchesPreset,
	POLICY_PRESETS,
	summarizeApprovalPolicy,
	TIER_COPY,
} from "./policy-copy";

const ASK_ALL: ApprovalPolicy = { read: "ask", write: "ask", execute: "ask" };

/** All 8 read × write × execute combinations, with their expected pill. */
const CASES: {
	policy: ApprovalPolicy;
	label: string;
	tone: string;
}[] = [
	{
		policy: { read: "ask", write: "ask", execute: "ask" },
		label: "Ask always",
		tone: "neutral",
	},
	{
		policy: { read: "auto", write: "ask", execute: "ask" },
		label: "Auto: read",
		tone: "accent",
	},
	{
		policy: { read: "ask", write: "auto", execute: "ask" },
		label: "Auto: write",
		tone: "warning",
	},
	{
		policy: { read: "auto", write: "auto", execute: "ask" },
		label: "Auto: read+write",
		tone: "warning",
	},
	{
		policy: { read: "ask", write: "ask", execute: "auto" },
		label: "Auto: run",
		tone: "danger",
	},
	{
		policy: { read: "auto", write: "ask", execute: "auto" },
		label: "Auto: read+run",
		tone: "danger",
	},
	{
		policy: { read: "ask", write: "auto", execute: "auto" },
		label: "Auto: write+run",
		tone: "danger",
	},
	{
		policy: { read: "auto", write: "auto", execute: "auto" },
		label: "Auto: all",
		tone: "danger",
	},
];

describe("summarizeApprovalPolicy", () => {
	it("covers every read/write/execute combination exactly once", () => {
		expect(CASES).toHaveLength(2 ** APPROVAL_TIERS.length);
		const keys = CASES.map((c) =>
			APPROVAL_TIERS.map((t) => c.policy[t]).join("/"),
		);
		expect(new Set(keys).size).toBe(CASES.length);
	});

	for (const { policy, label, tone } of CASES) {
		const key = APPROVAL_TIERS.map((t) => `${t}=${policy[t]}`).join(" ");
		it(`labels ${key} as "${label}" (${tone})`, () => {
			const summary = summarizeApprovalPolicy(policy);
			expect(summary.label).toBe(label);
			expect(summary.tone).toBe(tone);
		});
	}

	it("gives every combination a distinct label", () => {
		const labels = CASES.map((c) => summarizeApprovalPolicy(c.policy).label);
		expect(new Set(labels).size).toBe(CASES.length);
	});

	it("escalates to danger whenever shell commands are auto-approved", () => {
		for (const { policy } of CASES) {
			if (policy.execute === "auto") {
				expect(summarizeApprovalPolicy(policy).tone).toBe("danger");
			}
		}
	});

	it("never renders an empty tier list after the Auto: prefix", () => {
		for (const { policy } of CASES) {
			const { label } = summarizeApprovalPolicy(policy);
			expect(label.endsWith(": ")).toBe(false);
			expect(label.trim()).toBe(label);
		}
	});

	it("spells the state out as a sentence for screen readers", () => {
		expect(summarizeApprovalPolicy(ASK_ALL).spoken).toBe(
			"every tool call asks you first",
		);
		expect(
			summarizeApprovalPolicy({
				read: "auto",
				write: "auto",
				execute: "ask",
			}).spoken,
		).toContain("read and write run automatically");
	});

	it("summarizes the shipped default as full auto-approve", () => {
		expect(summarizeApprovalPolicy(DEFAULT_APPROVAL_POLICY).label).toBe(
			"Auto: all",
		);
	});
});

describe("TIER_COPY", () => {
	it("has copy for every tier, with a pill-sized short name", () => {
		for (const tier of APPROVAL_TIERS) {
			const copy = TIER_COPY[tier];
			expect(copy.label.length).toBeGreaterThan(0);
			expect(copy.risk.length).toBeGreaterThan(0);
			expect(copy.short).toMatch(/^[a-z]{3,6}$/);
		}
	});
});

describe("POLICY_PRESETS", () => {
	it("offers ask-all, read-only and everything, least permissive first", () => {
		expect(POLICY_PRESETS.map((p) => p.id)).toEqual([
			"ask-everything",
			"auto-reads",
			"auto-everything",
		]);
	});

	it("marks only the fully-permissive preset as dangerous", () => {
		const dangerous = POLICY_PRESETS.filter((p) => p.danger === true);
		expect(dangerous).toHaveLength(1);
		expect(dangerous[0]?.policy.execute).toBe("auto");
	});

	it("matches a policy against exactly one preset", () => {
		for (const preset of POLICY_PRESETS) {
			const hits = POLICY_PRESETS.filter((other) =>
				matchesPreset(preset.policy, other),
			);
			expect(hits).toEqual([preset]);
		}
	});

	it("matches no preset for a mixed policy", () => {
		const mixed: ApprovalPolicy = {
			read: "ask",
			write: "auto",
			execute: "ask",
		};
		expect(POLICY_PRESETS.some((p) => matchesPreset(mixed, p))).toBe(false);
	});
});
