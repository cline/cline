import type { AgentMode } from "@cline/shared";

const ENVIRONMENT_DETAILS_OPEN = "<environment_details>";
const ENVIRONMENT_DETAILS_CLOSE = "</environment_details>";
const WORKSPACE_CONFIGURATION_HEADING = "# Workspace Configuration";

export interface EnvironmentDetailsInput {
	cwd: string;
	mode?: AgentMode;
	workspaceMetadata?: string;
	now?: Date;
}

function formatMode(mode: AgentMode | undefined): string {
	switch (mode) {
		case "plan":
			return "PLAN MODE";
		case "yolo":
			return "YOLO MODE";
		case "zen":
			return "ZEN MODE";
		case "act":
		default:
			return "ACT MODE";
	}
}

function formatCurrentTime(now: Date): string {
	return now.toLocaleString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		second: "2-digit",
		timeZoneName: "short",
	});
}

export function buildEnvironmentDetails({
	cwd,
	mode,
	workspaceMetadata,
	now = new Date(),
}: EnvironmentDetailsInput): string {
	const sections = [`# Current Working Directory\n${cwd}`];
	const metadata = workspaceMetadata?.trim();

	if (metadata) {
		sections.push(
			metadata.startsWith(WORKSPACE_CONFIGURATION_HEADING)
				? metadata
				: `${WORKSPACE_CONFIGURATION_HEADING}\n${metadata}`,
		);
	}

	sections.push(`# Current Time\n${formatCurrentTime(now)}`);
	sections.push(`# Current Mode\n${formatMode(mode)}`);

	return `${ENVIRONMENT_DETAILS_OPEN}\n${sections.join("\n\n")}\n${ENVIRONMENT_DETAILS_CLOSE}`;
}

export function appendEnvironmentDetails(
	prompt: string,
	input: EnvironmentDetailsInput,
): string {
	if (prompt.includes(ENVIRONMENT_DETAILS_OPEN)) {
		return prompt;
	}

	return `${prompt}\n\n${buildEnvironmentDetails(input)}`;
}
