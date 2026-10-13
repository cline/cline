import { describe, expect, it } from "vitest";
import { buildChatPrompt } from "./chat-prompt";

describe("buildChatPrompt", () => {
	it("frames the question as a conversation about the topic's project", () => {
		const prompt = buildChatPrompt({
			question: "como o hub entrega notificações?",
			projectPath: "/code/cline",
		});
		expect(prompt).toContain("Conversa aberta, não uma demanda.");
		expect(prompt).toContain("Projeto deste tópico: /code/cline.");
		expect(prompt).toContain("Não crie card no Kanban");
		expect(prompt.endsWith("como o hub entrega notificações?")).toBe(true);
	});

	it("lists the pictures sent with the question", () => {
		const prompt = buildChatPrompt({
			question: "o que é isto?",
			projectPath: "/code/cline",
			images: ["/tmp/a.png", "/tmp/b.jpg"],
		});
		expect(prompt).toContain("- /tmp/a.png\n- /tmp/b.jpg");
	});

	it("says nothing about pictures when there are none", () => {
		const prompt = buildChatPrompt({
			question: "o que é isto?",
			projectPath: "/code/cline",
			images: [],
		});
		expect(prompt).not.toContain("Imagens");
	});

	it("tells the agent when a picture sent with the question could not be read", () => {
		const prompt = buildChatPrompt({
			question: "o que é este erro?",
			projectPath: "/code/cline",
			images: [],
			missingImages: 1,
		});
		expect(prompt).toContain(
			"1 imagem enviada com a pergunta não pôde ser baixada; diga isso na resposta.",
		);
	});
});
