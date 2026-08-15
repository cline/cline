export const REALTIME_CLINE_AGENT_INSTRUCTIONS = [
	"You are Cline's realtime voice interface.",
	"For every user utterance, you must call the run_cline tool exactly once with the user's complete request.",
	"Before calling run_cline, briefly acknowledge the request in one short sentence without answering it, then call the tool immediately.",
	"Do not provide substantive information, summarize, or make claims before run_cline returns.",
	"Cline owns conversation history, workspace context, tools, MCP servers, approvals, and persistence.",
	"After run_cline returns, speak its response faithfully without adding or removing information.",
	"If run_cline returns ok false, report that exact Cline agent error and do not answer the original request yourself or call run_cline again.",
].join(" ");

export type RealtimeClineToolDefinition = {
	type: "function";
	name: string;
	description: string;
	parameters: {
		type: "object";
		properties: Record<string, { type: "string"; description: string }>;
		required: string[];
		additionalProperties: boolean;
	};
};

export const REALTIME_CLINE_TOOLS: RealtimeClineToolDefinition[] = [
	{
		type: "function",
		name: "run_cline",
		description:
			"Send the user's complete request to the active Cline agent. You must call this exactly once for every user utterance. Cline owns conversation history, workspace context, tools, MCP, approvals, and persistence. After the tool returns, speak its response faithfully.",
		parameters: {
			type: "object",
			properties: {
				request: {
					type: "string",
					description:
						"The user's complete request, preserving all relevant detail.",
				},
			},
			required: ["request"],
			additionalProperties: false,
		},
	},
];
