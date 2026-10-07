import {
	type AgentExtension,
	type AgentTool,
	createTool,
	StatusPublishInputSchema,
	zodToJsonSchema,
} from "@cline/shared";
import type { StatusService } from "./status-service";

const ReportStatusInputSchema = StatusPublishInputSchema.pick({
	subject: true,
	state: true,
	headline: true,
	detail: true,
	priority: true,
	progress: true,
	tags: true,
});

export function createReportStatusTool(
	service: StatusService,
	resolveSession: (
		sessionId: string,
	) => Promise<{ workspaceRoot: string } | undefined>,
): AgentTool {
	return createTool({
		name: "report_status",
		description:
			"Report the status of a distinct piece of work to the Status Hub. Reuse its subject at meaningful milestones, when blocked, and when finished. Do not report after every tool call.",
		inputSchema: zodToJsonSchema(ReportStatusInputSchema),
		executionMode: "sequential",
		retryable: false,
		maxRetries: 0,
		execute: async (rawInput, context) => {
			const input = ReportStatusInputSchema.parse(rawInput);
			if (!context.sessionId)
				throw new Error("Status reports require a hosted session.");
			const session = await resolveSession(context.sessionId);
			if (!session)
				throw new Error("Reporting session is no longer available.");
			const agentName = context.metadata?.agentName;
			const update = service.publish({
				...input,
				sessionId: context.sessionId,
				agentId: context.agentId,
				agentName:
					typeof agentName === "string" && agentName.trim()
						? agentName
						: undefined,
				workspaceRoot: session.workspaceRoot,
				source: "agent",
			});
			return `Status recorded for "${update.subject}" as ${update.state} (update ${update.seq}).`;
		},
	});
}

export function createStatusPromptExtension(): AgentExtension {
	return {
		name: "hub-status-guidance",
		manifest: { capabilities: ["rules"] },
		setup(api) {
			api.registerRule({
				id: "hub:status-guidance",
				whenToolAvailable: "report_status",
				content:
					"# Status Hub\nUse report_status when you start a meaningful piece of work, at major milestones, when blocked, and when finished. Reuse one short subject for that piece of work. Keep headlines specific and concise. Mark completed work done, failures failed, and abandoned work cancelled. Routine conversation does not need a report. Do not report after every tool call.",
			});
		},
	};
}
