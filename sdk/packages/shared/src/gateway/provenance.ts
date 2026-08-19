/**
 * Run provenance contract (Gateway RFC, Phase 6).
 *
 * Every run records how it entered the system. Interactive runs come from
 * a human-facing client (desktop/CLI); connector runs are admitted by a
 * connector adapter on behalf of an external conversation; automation
 * runs are created by schedules and always carry the explicit
 * `automation` mode — an automation is an ordinary run with provenance,
 * never a parallel execution path.
 */

import { z } from "zod";
import { ConnectorIdSchema, PrincipalIdSchema, ScheduleIdSchema } from "./ids";

export const RUN_MODES = ["interactive", "connector", "automation"] as const;

export type RunMode = (typeof RUN_MODES)[number];

export const RunModeSchema = z.enum(RUN_MODES);

export const RunProvenanceSchema = z
	.object({
		mode: RunModeSchema,
		/** Client/actor that admitted the run (client id, adapter, scheduler). */
		submittedBy: z.string().min(1),
		principalId: PrincipalIdSchema.optional(),
		/** Present when `mode` is `connector`. */
		connectorId: ConnectorIdSchema.optional(),
		/** Normalized external conversation, never adapter credentials. */
		externalAccountId: z.string().min(1).optional(),
		externalConversationId: z.string().min(1).optional(),
		/** Present when `mode` is `automation`. */
		scheduleId: ScheduleIdSchema.optional(),
		reason: z.string().optional(),
	})
	.strict()
	.superRefine((value, ctx) => {
		if (value.mode === "connector" && !value.connectorId) {
			ctx.addIssue({
				code: "custom",
				message: "Connector runs must name their connectorId",
			});
		}
		if (value.mode === "automation" && !value.scheduleId) {
			ctx.addIssue({
				code: "custom",
				message: "Automation runs must name their scheduleId",
			});
		}
	});

export type RunProvenance = z.infer<typeof RunProvenanceSchema>;

export function interactiveProvenance(submittedBy: string): RunProvenance {
	return RunProvenanceSchema.parse({ mode: "interactive", submittedBy });
}
