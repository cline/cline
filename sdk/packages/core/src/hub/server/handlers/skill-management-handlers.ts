import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import { z } from "zod";
import type { SkillManagementService } from "../../../services/skill-management";
import { errorReply, okReply } from "./context";

const id = z.string().trim().min(1).max(256);
export async function handleSkillManagementCommand(
	envelope: HubCommandEnvelope,
	service: SkillManagementService,
	workspaceRoot?: string,
): Promise<HubReplyEnvelope> {
	try {
		const payload = envelope.payload ?? {};
		switch (envelope.command) {
			case "skills.marketplace.status":
				return okReply(
					envelope,
					await service.status(
						z
							.object({ ids: z.array(id).max(500) })
							.strict()
							.parse(payload).ids,
					),
				);
			case "skills.marketplace.install":
				return okReply(
					envelope,
					await service.install(z.object({ id }).strict().parse(payload).id),
				);
			case "skills.marketplace.uninstall":
				return okReply(
					envelope,
					await service.uninstall(z.object({ id }).strict().parse(payload).id),
				);
			case "skills.remove": {
				const input = z
					.object({
						path: z.string().min(1),
						workspaceRoot: z.string().min(1).optional(),
					})
					.strict()
					.parse(payload);
				return okReply(
					envelope,
					await service.remove(
						input.path,
						input.workspaceRoot ?? workspaceRoot,
					),
				);
			}
			default:
				return errorReply(
					envelope,
					"unknown_command",
					"Unknown skill management command",
				);
		}
	} catch (error) {
		return errorReply(
			envelope,
			error instanceof z.ZodError
				? "invalid_payload"
				: "skill_management_failed",
			error instanceof Error ? error.message : String(error),
		);
	}
}
