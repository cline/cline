# `/chat` e respostas longas como `.md` — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Respostas finais longas do agente no Telegram chegam como um arquivo `.md`, e um comando `/chat <pergunta>` leva uma conversa aberta para a sessão do tópico sem criar card.

**Architecture:** A Parte 1 fica toda em `apps/cli/src/connectors/adapters/telegram-format.ts`. Quando o texto formatado não cabe em uma mensagem, `postTelegramFormattedReply` tenta primeiro o `sendDocument` e, se falhar, volta ao envio em pedaços. A Parte 2 registra `/chat` no host de comandos compartilhado (`apps/cli/src/utils/chat-commands.ts`). O comando entrega ao turno, via `context.submitPrompt`, um prompt montado por `buildChatPrompt` (`apps/cli/src/utils/chat-prompt.ts`). A sessão do tópico é a mesma e o prompt de sistema não muda.

**Tech Stack:** TypeScript, Bun (gerenciador), Vitest (`bun run test:unit` em `apps/cli`), Telegram Bot API (`sendMessage`, `sendDocument` multipart), `@gramio/format/markdown`.

**Spec:** `docs/superpowers/specs/2026-10-12-connector-chat-mode-design.md`

## Global Constraints

- Limite de uma mensagem do Telegram: 4096 caracteres (`TELEGRAM_MESSAGE_LIMIT`).
- Limite da legenda: 1024 caracteres, sem `parse_mode` nem entidades.
- Texto da nota na legenda: `… (resposta completa no arquivo)`.
- Nome do arquivo: slug do primeiro título (`#` a `######`). O slug fica em minúsculas, sem acentos, só com `a-z0-9` e `-`, no máximo 60 caracteres, mais `.md`. Sem título: `resposta-AAAA-MM-DD-HHmm.md` (hora local).
- O arquivo contém o texto **original** do agente, em UTF-8.
- Só respostas finais (`postFinalReply`) viram `.md`. Mensagens de status, notificações de card e entregas agendadas ficam como estão.
- O `/chat` entra na **mesma sessão** do tópico. Não muda o prompt de sistema nem cria modo ou sessão nova.
- O projeto do `/chat` é `state.workspaceRoot || state.cwd`, igual ao `/task`.
- Uso do comando: `Usage: /chat <pergunta> - conversa aberta, sem criar card`.
- Sem `.changeset/`. Bun, nunca npm/yarn/pnpm.

## Review Focus

1. Pergunta do `/chat` em várias linhas: as quebras de linha chegam intactas ao agente, porque o host divide `args` por `\s+`. Teste na Task 2.
2. Um `# comentário` dentro de um bloco de código antes do primeiro título real não pode virar o nome do arquivo. Teste na Task 1.
3. Uma resposta longa num tópico de fórum vai para o tópico certo (`message_thread_id`), não para o "General". Teste na Task 1.
4. Se o `sendDocument` falhar, a resposta ainda chega inteira em mensagens, sem duplicar nem perder texto. Teste na Task 1.
5. `/chat` numa superfície sem agente não pode salvar imagens à toa: recusa antes de baixar. Teste na Task 2.

---

### Task 1: Resposta longa como documento `.md` no Telegram

**Files:**
- Modify: `apps/cli/src/connectors/adapters/telegram-format.ts`
- Test: `apps/cli/src/connectors/adapters/telegram-format.test.ts`
- Modify: `apps/cli/src/connectors/adapters/telegram.md` (seção "Message Delivery")

**Interfaces:**
- Consumes: `parseTelegramThreadId`, `buildTelegramFormattedPayloads`, `readTelegramApiResponse` (já existem no arquivo).
- Produces:
  - `export function buildTelegramDocumentName(text: string, now: Date): string`
  - `export function buildTelegramDocumentCaption(text: string): string`
  - `postTelegramFormattedReply` recebe o campo opcional novo `now?: () => Date`.

- [ ] **Step 1: Escrever os testes que falham**

Em `telegram-format.test.ts`, adicionar ao import:

```ts
import {
	buildTelegramDocumentCaption,
	buildTelegramDocumentName,
	buildTelegramFormattedPayload,
	buildTelegramFormattedPayloads,
	parseTelegramThreadId,
	postTelegramFormattedReply,
} from "./telegram-format";
```

Substituir o teste `"sends long formatted replies as multiple Telegram messages"` por estes, dentro do mesmo `describe`:

```ts
	it("sends a reply too long for one message as a single .md document", async () => {
		const { thread } = createThread("telegram:-100123:7");
		const text = `# Pesquisa de filas\n\n${"palavra ".repeat(700)}`;
		const fetchImpl = vi.fn(async (_url: string | URL, _init?: RequestInit) => {
			return new Response(JSON.stringify({ ok: true, result: {} }), {
				status: 200,
			});
		});

		await postTelegramFormattedReply({
			thread,
			text,
			botToken: "token",
			logger: createLogger(),
			fetchImpl,
		});

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, init] = fetchImpl.mock.calls[0] ?? [];
		expect(url).toBe("https://api.telegram.org/bottoken/sendDocument");
		const form = (init as RequestInit).body as FormData;
		expect(form.get("chat_id")).toBe("-100123");
		expect(form.get("message_thread_id")).toBe("7");
		const document = form.get("document") as File;
		expect(document.name).toBe("pesquisa-de-filas.md");
		expect(await document.text()).toBe(text);
		const caption = String(form.get("caption"));
		expect(caption.length).toBeLessThanOrEqual(1024);
		expect(caption.startsWith("Pesquisa de filas")).toBe(true);
		expect(caption).toMatch(/palavra… \(resposta completa no arquivo\)$/);
		expect(form.get("parse_mode")).toBeNull();
		expect(thread.post).not.toHaveBeenCalled();
	});

	it("still sends the whole reply as messages when the document is refused", async () => {
		const { thread } = createThread("telegram:123");
		const text = `${"a".repeat(4096)}tail`;
		const logger = createLogger();
		const fetchImpl = vi.fn(async (url: string | URL, _init?: RequestInit) => {
			if (String(url).endsWith("/sendDocument")) {
				return new Response(
					JSON.stringify({ ok: false, description: "Bad Request: file" }),
					{ status: 400, statusText: "Bad Request" },
				);
			}
			return new Response(JSON.stringify({ ok: true, result: {} }), {
				status: 200,
			});
		});

		await postTelegramFormattedReply({
			thread,
			text,
			botToken: "token",
			logger,
			fetchImpl,
		});

		const bodies = fetchImpl.mock.calls
			.filter(([url]) => String(url).endsWith("/sendMessage"))
			.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
		expect(bodies.map((body) => body.text).join("")).toBe(text);
		expect(bodies).toHaveLength(2);
		expect(logger.core.log).toHaveBeenCalledWith(
			"Telegram document reply failed; sending as messages",
			expect.objectContaining({ severity: "warn", transport: "telegram" }),
		);
		expect(thread.post).not.toHaveBeenCalled();
	});

	it("names the document after the first heading, without accents", () => {
		expect(
			buildTelegramDocumentName(
				"Intro\n\n## Análise de Ações & Riscos\n\ncorpo",
				new Date(2026, 9, 12, 9, 30),
			),
		).toBe("analise-de-acoes-riscos.md");
	});

	it("ignores a # line inside a code block when naming the document", () => {
		expect(
			buildTelegramDocumentName(
				"```bash\n# instala tudo\nbun install\n```\n\n# Guia real\n",
				new Date(2026, 9, 12, 9, 30),
			),
		).toBe("guia-real.md");
	});

	it("names the document by date when the reply has no heading", () => {
		expect(
			buildTelegramDocumentName("só texto", new Date(2026, 9, 12, 9, 5)),
		).toBe("resposta-2026-10-12-0905.md");
	});

	it("keeps a long heading to 60 characters without a trailing dash", () => {
		const name = buildTelegramDocumentName(
			`# ${"palavra ".repeat(20)}`,
			new Date(2026, 9, 12, 9, 30),
		);
		const slug = name.replace(/\.md$/, "");
		expect(slug.length).toBeLessThanOrEqual(60);
		expect(slug.endsWith("-")).toBe(false);
	});

	it("captions the document with its start as plain text", () => {
		const caption = buildTelegramDocumentCaption(
			`**Resumo** com \`código\`\n\n${"palavra ".repeat(300)}`,
		);
		expect(caption.startsWith("Resumo com código")).toBe(true);
		expect(caption.length).toBeLessThanOrEqual(1024);
		expect(caption.endsWith("… (resposta completa no arquivo)")).toBe(true);
	});
```

O teste existente `"chunks raw fallback text when formatted send fails"` continua como está. Nele o `fetchImpl` falha sempre: o documento falha, as mensagens falham e o texto cai no `thread.post` em pedaços. Ele confirma que a cadeia de fallback inteira continua funcionando.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/cli && bun run test:unit -- src/connectors/adapters/telegram-format.test.ts`
Expected: FAIL. Os imports `buildTelegramDocumentName` e `buildTelegramDocumentCaption` não existem, e a resposta longa ainda vai por `sendMessage`.

- [ ] **Step 3: Implementar**

Em `telegram-format.ts`, logo abaixo de `const TELEGRAM_MESSAGE_LIMIT = 4096;`:

```ts
const TELEGRAM_CAPTION_LIMIT = 1024;
const TELEGRAM_DOCUMENT_NOTE = "… (resposta completa no arquivo)";
const TELEGRAM_DOCUMENT_SLUG_LIMIT = 60;
```

Fazer `describeTelegramApiFailure` e `readTelegramApiResponse` receberem o nome do método. Hoje a mensagem de erro diz sempre `sendMessage`:

```ts
function describeTelegramApiFailure(
	response: Response,
	body: string,
	parsed: TelegramApiResponse | undefined,
	method: string,
): string {
	const detail = parsed?.description || body.trim().slice(0, 240);
	return detail
		? `Telegram ${method} failed (${response.status} ${response.statusText}): ${detail}`
		: `Telegram ${method} failed (${response.status} ${response.statusText})`;
}

async function readTelegramApiResponse(
	response: Response,
	method = "sendMessage",
): Promise<TelegramApiResponse | undefined> {
	const text = await response.text();
	try {
		const parsed = JSON.parse(text) as TelegramApiResponse;
		if (!response.ok || parsed.ok !== true) {
			throw new Error(
				describeTelegramApiFailure(response, text, parsed, method),
			);
		}
		return parsed;
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new Error(
				describeTelegramApiFailure(response, text, undefined, method),
			);
		}
		throw error;
	}
}
```

Adicionar, antes de `postTelegramFormattedReply`:

```ts
/**
 * The file a long reply arrives as is named after what it is about: its first heading.
 * A `# comment` in a shell block is not a heading, so fenced code is skipped first.
 */
export function buildTelegramDocumentName(text: string, now: Date): string {
	const withoutCode = text.replace(/^```[\s\S]*?^```/gm, "");
	const heading = withoutCode.match(/^#{1,6}[ \t]+(.+?)[ \t#]*$/m)?.[1] ?? "";
	const slug = heading
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, TELEGRAM_DOCUMENT_SLUG_LIMIT)
		.replace(/-+$/, "");
	if (slug) {
		return `${slug}.md`;
	}
	const pad = (value: number) => String(value).padStart(2, "0");
	return `resposta-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.md`;
}

/**
 * What shows under the file in the chat: the reply's opening as plain text, cut at a word,
 * so the conversation still reads without opening the file.
 */
export function buildTelegramDocumentCaption(text: string): string {
	const plain = markdownToFormattable(normalizeTelegramText(text))
		.text.replace(/[ \t]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	const room = TELEGRAM_CAPTION_LIMIT - TELEGRAM_DOCUMENT_NOTE.length;
	let cut = plain.slice(0, room);
	const lastBreak = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("\n"));
	if (plain.length > room && lastBreak > room / 2) {
		cut = cut.slice(0, lastBreak);
	}
	return `${cut.trimEnd()}${TELEGRAM_DOCUMENT_NOTE}`;
}

async function sendTelegramDocument(input: {
	apiBaseUrl: string;
	botToken: string;
	threadId: string;
	text: string;
	now: Date;
	fetchImpl: FetchLike;
}): Promise<void> {
	const parsedThread = parseTelegramThreadId(input.threadId);
	const form = new FormData();
	form.append("chat_id", parsedThread.chatId);
	if (parsedThread.messageThreadId !== undefined) {
		form.append("message_thread_id", String(parsedThread.messageThreadId));
	}
	form.append("caption", buildTelegramDocumentCaption(input.text));
	form.append(
		"document",
		new Blob([input.text], { type: "text/markdown;charset=utf-8" }),
		buildTelegramDocumentName(input.text, input.now),
	);
	const response = await input.fetchImpl(
		`${input.apiBaseUrl}/bot${input.botToken}/sendDocument`,
		{ method: "POST", body: form },
	);
	await readTelegramApiResponse(response, "sendDocument");
}
```

Substituir `postTelegramFormattedReply` por:

```ts
export async function postTelegramFormattedReply<
	TState extends ConnectorThreadState,
>(input: {
	thread: Thread<TState>;
	text: string;
	botToken: string;
	logger: CliLoggerAdapter;
	apiBaseUrl?: string;
	fetchImpl?: FetchLike;
	now?: () => Date;
}): Promise<void> {
	const fetchImpl = input.fetchImpl ?? fetch;
	const apiBaseUrl = trimTrailingSlashes(
		input.apiBaseUrl?.trim() || TELEGRAM_API_BASE,
	);
	let payloads: TelegramSendMessagePayload[] = [];
	let sentPayloadCount = 0;
	try {
		payloads = buildTelegramFormattedPayloads(input.thread.id, input.text);
		// More than one message means Telegram would get the reply in slices cut every 4096
		// characters, mid-word or mid-code-block. One file reads better; the slices stay as
		// the way out when Telegram refuses the file.
		if (payloads.length > 1) {
			try {
				await sendTelegramDocument({
					apiBaseUrl,
					botToken: input.botToken,
					threadId: input.thread.id,
					text: input.text,
					now: input.now?.() ?? new Date(),
					fetchImpl,
				});
				return;
			} catch (error) {
				input.logger.core.log(
					"Telegram document reply failed; sending as messages",
					{
						severity: "warn",
						transport: "telegram",
						threadId: input.thread.id,
						error: error instanceof Error ? error.message : String(error),
					},
				);
			}
		}
		for (const payload of payloads) {
			const response = await fetchImpl(
				`${apiBaseUrl}/bot${input.botToken}/sendMessage`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payload),
				},
			);
			await readTelegramApiResponse(response);
			sentPayloadCount += 1;
		}
	} catch (error) {
		// (bloco catch existente, sem mudanças)
	}
}
```

Manter o `catch` externo exatamente como está hoje: fallback para `thread.post` com `chunkTelegramRawText`.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd apps/cli && bun run test:unit -- src/connectors/adapters/telegram-format.test.ts`
Expected: PASS, todos os testes do arquivo.

- [ ] **Step 5: Documentar**

Em `apps/cli/src/connectors/adapters/telegram.md`, na seção "Message Delivery", trocar o parágrafo que começa com "Long final assistant replies are split" por:

```markdown
A final assistant reply too long for one Telegram message (4096 characters) arrives as a single `.md` file holding the full reply, captioned with its opening lines. The file is named after the reply's first heading, or `resposta-YYYY-MM-DD-HHmm.md` when it has none. If Telegram refuses the file, the reply is split across messages instead. Tool/status updates and scheduled delivery messages use the adapter's raw thread posting path.
```

- [ ] **Step 6: Typecheck, lint e commit**

Run: `cd apps/cli && bun run typecheck` → sem erros.
Run: `bun biome check --diagnostic-level=error apps/cli/src/connectors/adapters/` (na raiz) → sem erros.

```bash
git add apps/cli/src/connectors/adapters/telegram-format.ts apps/cli/src/connectors/adapters/telegram-format.test.ts apps/cli/src/connectors/adapters/telegram.md
git commit -m "feat: a Telegram reply too long for one message arrives as a .md file

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Comando `/chat`

**Files:**
- Create: `apps/cli/src/utils/chat-prompt.ts`
- Test: `apps/cli/src/utils/chat-prompt.test.ts`
- Modify: `apps/cli/src/utils/chat-commands.ts` (`formatHelp` e registro após `/task`)
- Test: `apps/cli/src/utils/chat-commands.test.ts`
- Modify: `apps/cli/src/connectors/adapters/telegram.md` (seção "Chat Commands")

**Interfaces:**
- Consumes: `ChatCommandContext.submitPrompt?: (prompt: string) => void | Promise<void>` e `ChatCommandContext.images?: () => Promise<IncomingImages | undefined>` (já existem). `ParsedChatCommand.trimmed`: a mensagem inteira, sem espaços nas pontas.
- Produces: `export function buildChatPrompt(input: { question: string; projectPath: string; images?: string[] }): string`

- [ ] **Step 1: Escrever os testes que falham**

Criar `apps/cli/src/utils/chat-prompt.test.ts`:

```ts
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
});
```

Em `chat-commands.test.ts`, adicionar ao final do arquivo:

```ts
describe("/chat", () => {
	function context(input: {
		reply: (text: string) => Promise<void>;
		submitPrompt?: (prompt: string) => void;
		images?: () => Promise<{
			dir: string;
			paths: string[];
			failed: number;
			refused: number;
		}>;
	}) {
		return {
			enabled: true,
			getState: async () => ({
				enableTools: true,
				autoApproveTools: false,
				cwd: "/home/me/.cline/worktrees/461e5/partyshare",
				workspaceRoot: "/code/partyshare",
			}),
			setState: async () => undefined,
			reply: input.reply,
			submitPrompt: input.submitPrompt,
			images: input.images,
		};
	}

	it("hands the question to the agent and files no card", async () => {
		vi.mocked(createKanbanTask).mockClear();
		const submitPrompt = vi.fn<(prompt: string) => void>();
		const reply = vi.fn<(text: string) => Promise<void>>(async () => undefined);

		const handled = await maybeHandleChatCommand(
			"/chat o que muda se a fila for por tópico?",
			context({ reply, submitPrompt }),
		);

		expect(handled).toBe(true);
		expect(createKanbanTask).not.toHaveBeenCalled();
		const prompt = submitPrompt.mock.calls[0]?.[0] ?? "";
		expect(prompt).toContain("Projeto deste tópico: /code/partyshare.");
		expect(prompt).toContain("o que muda se a fila for por tópico?");
		expect(reply).not.toHaveBeenCalled();
	});

	it("keeps the line breaks of a question written over several lines", async () => {
		const submitPrompt = vi.fn<(prompt: string) => void>();
		await maybeHandleChatCommand(
			"/chat compare:\n- fila por tópico\n- fila global",
			context({ reply: async () => undefined, submitPrompt }),
		);
		expect(submitPrompt.mock.calls[0]?.[0]).toContain(
			"compare:\n- fila por tópico\n- fila global",
		);
	});

	it("passes the pictures sent with the question", async () => {
		const submitPrompt = vi.fn<(prompt: string) => void>();
		await maybeHandleChatCommand(
			"/chat o que é este erro?",
			context({
				reply: async () => undefined,
				submitPrompt,
				images: async () => ({
					dir: "/tmp/imgs",
					paths: ["/tmp/imgs/erro.png"],
					failed: 0,
					refused: 0,
				}),
			}),
		);
		expect(submitPrompt.mock.calls[0]?.[0]).toContain("- /tmp/imgs/erro.png");
	});

	it("shows usage when there is no question", async () => {
		const submitPrompt = vi.fn<(prompt: string) => void>();
		const reply = vi.fn<(text: string) => Promise<void>>(async () => undefined);
		await maybeHandleChatCommand("/chat", context({ reply, submitPrompt }));
		expect(submitPrompt).not.toHaveBeenCalled();
		expect(reply).toHaveBeenCalledWith(
			"Usage: /chat <pergunta> - conversa aberta, sem criar card",
		);
	});

	it("refuses before saving pictures when the surface has no agent", async () => {
		const images = vi.fn(async () => undefined);
		const reply = vi.fn<(text: string) => Promise<void>>(async () => undefined);
		await maybeHandleChatCommand(
			"/chat o que é isto?",
			context({ reply, images }),
		);
		expect(images).not.toHaveBeenCalled();
		expect(reply).toHaveBeenCalledWith(
			expect.stringContaining("cannot chat here"),
		);
	});

	it("is listed in the help", async () => {
		const reply = vi.fn<(text: string) => Promise<void>>(async () => undefined);
		await maybeHandleChatCommand("/help", context({ reply }));
		expect(reply).toHaveBeenCalledWith(
			expect.stringContaining("/chat <question>"),
		);
	});
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/cli && bun run test:unit -- src/utils/chat-prompt.test.ts src/utils/chat-commands.test.ts`
Expected: FAIL. `./chat-prompt` não existe e `/chat` não é tratado (`handled` é `false`).

- [ ] **Step 3: Implementar**

Criar `apps/cli/src/utils/chat-prompt.ts`:

```ts
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
			? ["", "Imagens enviadas com a pergunta:", ...images.map((path) => `- ${path}`)]
			: []),
		"",
		input.question,
	].join("\n");
}
```

Em `chat-commands.ts`, importar:

```ts
import { buildChatPrompt } from "./chat-prompt";
```

Em `formatHelp`, logo depois da linha do `/task`:

```ts
		"/chat <question> - ask, research or work something out here, without filing a card",
```

Registrar o comando logo depois do bloco `.register("command", { names: ["/task"], ... })`:

```ts
		.register("command", {
			names: ["/chat"],
			run: async ({ trimmed, state }, context) => {
				// From the message itself, not `args`: those are split on whitespace, and a
				// question written over several lines would reach the agent as one.
				const question = trimmed.replace(/^\S+\s*/, "").trim();
				if (!question) {
					await context.reply(
						"Usage: /chat <pergunta> - conversa aberta, sem criar card",
					);
					return;
				}
				// Before the pictures: nothing should be saved for an agent that is not there.
				if (!context.submitPrompt) {
					await context.reply(
						"I cannot chat here -- this surface has no agent to hand the question to.",
					);
					return;
				}
				const images = await context.images?.();
				await context.submitPrompt(
					buildChatPrompt({
						question,
						projectPath: state.workspaceRoot || state.cwd,
						images: images?.paths,
					}),
				);
			},
		})
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd apps/cli && bun run test:unit -- src/utils/chat-prompt.test.ts src/utils/chat-commands.test.ts`
Expected: PASS.

- [ ] **Step 5: Documentar**

Em `apps/cli/src/connectors/adapters/telegram.md`, na lista de "Chat Commands", depois de `/whereami`:

```markdown
- `/chat <question>` - ask, research or work something out in this topic's session without filing a Kanban card; the agent keeps the conversation's context, so a later `/task` can build on it
```

- [ ] **Step 6: Suíte do CLI, typecheck, lint e commit**

Run: `cd apps/cli && bun run test:unit` → tudo passa (falhas que já existiam antes da mudança devem ser apontadas, não escondidas).
Run: `cd apps/cli && bun run typecheck` → sem erros.
Run: `bun biome check --diagnostic-level=error apps/cli/src/utils/ apps/cli/src/connectors/adapters/` (na raiz) → sem erros.

```bash
git add apps/cli/src/utils/chat-prompt.ts apps/cli/src/utils/chat-prompt.test.ts apps/cli/src/utils/chat-commands.ts apps/cli/src/utils/chat-commands.test.ts apps/cli/src/connectors/adapters/telegram.md
git commit -m "feat: /chat asks the topic's agent without filing a card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Verificação de ponta a ponta no Telegram (manual)

Sem código novo. Confirma no conector de verdade o que os testes simulam.

- [ ] **Step 1:** `bun run build:sdk` (na raiz). Depois reiniciar o conector: `bun run cli connect --stop telegram` e `bun run cli connect telegram -k "$TELEGRAM_BOT_TOKEN"`.
- [ ] **Step 2:** Num tópico ligado a um projeto, mandar `/chat explique em detalhes, com títulos, como funciona o fluxo de um card do Kanban até o Telegram neste projeto`. Confirmar:
  - a resposta chega no mesmo tópico;
  - nenhum card novo aparece no board;
  - se a resposta for longa, chega como `.md`, com a legenda e o nome tirado do título.
- [ ] **Step 3:** Em seguida, no mesmo tópico, mandar `/task --brainstorm transformar isso num card` e confirmar que o agente se refere ao que foi conversado (mesma sessão).
