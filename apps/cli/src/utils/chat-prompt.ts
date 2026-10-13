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
	/** Pictures that came with the question but could not be downloaded or were refused. */
	missingImages?: number;
}): string {
	const images = input.images ?? [];
	const missing = input.missingImages ?? 0;
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
		// Said to the agent, or it answers as if the picture never existed.
		...(missing > 0
			? [
					"",
					missing === 1
						? "1 imagem enviada com a pergunta não pôde ser baixada; diga isso na resposta."
						: `${missing} imagens enviadas com a pergunta não puderam ser baixadas; diga isso na resposta.`,
				]
			: []),
		"",
		input.question,
	].join("\n");
}
