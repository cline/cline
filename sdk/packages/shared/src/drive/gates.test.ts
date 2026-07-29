import { describe, expect, it } from "vitest";
import {
	DEFAULT_UNKNOWN_GATE_CLASS,
	DRIVE_GATE_TAXONOMY_SCHEMA_VERSION,
	GATE_ACTION_CLASSES,
	GATE_CLASS_DEFAULT_DISPOSITION,
	GateActionClassSchema,
	assertNeverGateActionClass,
	defaultDispositionForGateClass,
	parseGateActionClass,
	type GateActionClass,
} from "./gates";

describe("DRV-GATES taxonomy", () => {
	it("pins schema version 1", () => {
		expect(DRIVE_GATE_TAXONOMY_SCHEMA_VERSION).toBe(1);
	});

	it("parses every known v1 class id", () => {
		const expected = [
			"fs.destructive",
			"git.mutating",
			"net.exfil",
			"shell.unchecked",
			"secrets.read",
			"policy.hard",
		] as const;
		expect(GATE_ACTION_CLASSES).toEqual([...expected]);
		for (const id of expected) {
			expect(parseGateActionClass(id)).toBe(id);
			expect(GateActionClassSchema.safeParse(id).success).toBe(true);
		}
	});

	it("rejects unknown class ids", () => {
		expect(GateActionClassSchema.safeParse("fs.write_outside").success).toBe(
			false,
		);
		expect(GateActionClassSchema.safeParse("ungated").success).toBe(false);
		expect(GateActionClassSchema.safeParse("").success).toBe(false);
		expect(() => parseGateActionClass("not.a.class")).toThrow();
	});

	it("maps default dispositions per DRV-GATES.md", () => {
		expect(defaultDispositionForGateClass("fs.destructive")).toBe("approve");
		expect(defaultDispositionForGateClass("git.mutating")).toBe("approve");
		expect(defaultDispositionForGateClass("net.exfil")).toBe("approve");
		expect(defaultDispositionForGateClass("shell.unchecked")).toBe("approve");
		expect(defaultDispositionForGateClass("secrets.read")).toBe("approve");
		expect(defaultDispositionForGateClass("policy.hard")).toBe("block");
		expect(GATE_CLASS_DEFAULT_DISPOSITION["policy.hard"]).toBe("block");
	});

	it("defaults unknown tools to shell.unchecked", () => {
		expect(DEFAULT_UNKNOWN_GATE_CLASS).toBe("shell.unchecked");
		expect(parseGateActionClass(DEFAULT_UNKNOWN_GATE_CLASS)).toBe(
			"shell.unchecked",
		);
	});

	it("assertNeverGateActionClass is exhaustive", () => {
		const classify = (actionClass: GateActionClass): string => {
			switch (actionClass) {
				case "fs.destructive":
				case "git.mutating":
				case "net.exfil":
				case "shell.unchecked":
				case "secrets.read":
				case "policy.hard":
					return actionClass;
				default:
					return assertNeverGateActionClass(actionClass);
			}
		};
		expect(classify("policy.hard")).toBe("policy.hard");
	});
});
