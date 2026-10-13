/**
 * `/chat` is a question, not a demand. It goes into the topic's own session, so the agent
 * keeps everything said before -- which is why the "do not file anything" rule rides on the
 * message instead of the system prompt: changing the system prompt clears the session.
 */
export function buildChatPrompt(input: {
	question: string;
	projectPath: string;
	/** Pictures sent with the question, saved for the agent to read. */
	images?: string[];
}): string {
	const images = input.images ?? [];
	return [
		`Conversa aberta, não uma demanda. Projeto deste tópico: ${input.projectPath}.`,
		"A pergunta pode ser sobre ele ou geral. Pesquise, explique ou processe o que",
		"for pedido e responda aqui. Não crie card no Kanban, não altere arquivos,",
		"não faça commit e não rode comandos que mudem estado, a menos que o pedido",
		"abaixo diga isso explicitamente.",
		...(images.length > 0
			? [
					"",
					"Imagens enviadas com a pergunta:",
					...images.map((path) => `- ${path}`),
				]
			: []),
		"",
		input.question,
	].join("\n");
}
