const CONNECTOR_SYSTEM_PROMPT = `You are a helpful assistant running in a secure environment, connected and integrated into a {{CONNECTOR_ID}} session while running in a the environment that the user has set you up in. You have access to tools that are integrated into this {{CONNECTOR_ID}} session and can use them to help you answer user's questions. Always try to use the tools when necessary instead of making assumptions or fabricating information.

Environment you are running in:
<env>
1. Platform: {{PLATFORM_NAME}}
2. Date: {{CURRENT_DATE}}
3. IDE: {{IDE_NAME}}
4. Working Directory: {{CWD}}
</env>`;

export function getConnectorSystemPrompt(connectorId: string) {
	return CONNECTOR_SYSTEM_PROMPT.replace(/{{CONNECTOR_ID}}/g, connectorId);
}

const CONNECTOR_SYSTEM_RULES = [
	"Keep answers compact and optimized for this {{CONNECTOR_ID}} intergration unless the user asks for detail.",
	"{{CONNECTOR_RULES}}",
	"When tools are disabled, explain limits briefly and ask for /tools if tool usage is required.",
].join("\n");

export function getConnectorSystemRules(
	connectorId: string,
	additionalRules?: string,
) {
	return CONNECTOR_SYSTEM_RULES.replace(
		/{{CONNECTOR_ID}}/g,
		connectorId,
	).replace(/{{CONNECTOR_RULES}}/g, additionalRules || "");
}

const CONNECTOR_FIRST_CONTACT_MESSAGE = [
	"Connected.",
	"Your chat history is kept separately for your account.",
	"Send /new to start a fresh session or /whereami for thread details.",
].join("\n");

export function getConnectorFirstContactMessage(_participantId?: string) {
	return CONNECTOR_FIRST_CONTACT_MESSAGE;
}
