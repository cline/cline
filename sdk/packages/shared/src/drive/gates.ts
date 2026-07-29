/**
 * DRV-GATES v1 action taxonomy (Phase 0 schema stub).
 *
 * High-impact classes that must emit a gate when Drive is active
 * (unless session-allowed). Feed-card UI and approval projection are later.
 */

import { z } from "zod";

/** Taxonomy schema version — bump when classes or dispositions change. */
export const DRIVE_GATE_TAXONOMY_SCHEMA_VERSION = 1 as const;

/**
 * v1 high-impact action classes from DRV-GATES.md.
 * Unknown tools should classify as `shell.unchecked` (or an explicit ungated
 * allowlist entry outside this enum) — never silently skip.
 */
export const GateActionClassSchema = z.enum([
	"fs.destructive",
	"git.mutating",
	"net.exfil",
	"shell.unchecked",
	"secrets.read",
	"policy.hard",
]);
export type GateActionClass = z.infer<typeof GateActionClassSchema>;

export const GATE_ACTION_CLASSES = GateActionClassSchema.options;

/** Default disposition when a gate fires for the class. */
export const GateDispositionSchema = z.enum(["approve", "block"]);
export type GateDisposition = z.infer<typeof GateDispositionSchema>;

/** Fallback class for tools that do not match a narrower bucket. */
export const DEFAULT_UNKNOWN_GATE_CLASS = "shell.unchecked" as const satisfies GateActionClass;

export const GATE_CLASS_DEFAULT_DISPOSITION: Readonly<
	Record<GateActionClass, GateDisposition>
> = {
	"fs.destructive": "approve",
	"git.mutating": "approve",
	"net.exfil": "approve",
	"shell.unchecked": "approve",
	"secrets.read": "approve",
	"policy.hard": "block",
};

export function parseGateActionClass(input: unknown): GateActionClass {
	return GateActionClassSchema.parse(input);
}

export function defaultDispositionForGateClass(
	actionClass: GateActionClass,
): GateDisposition {
	return GATE_CLASS_DEFAULT_DISPOSITION[actionClass];
}

/**
 * Exhaustive helper for switches on GateActionClass.
 */
export function assertNeverGateActionClass(actionClass: never): never {
	throw new Error(
		`Unhandled GateActionClass: ${JSON.stringify(actionClass satisfies never)}`,
	);
}
