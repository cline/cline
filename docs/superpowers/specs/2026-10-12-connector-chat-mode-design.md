# `/chat` nos conectores e respostas longas como `.md` no Telegram

Data: 2026-10-12

## Objetivo

1. Um comando `/chat <pergunta>` para conversa aberta (pesquisa, processamento,
   informação geral) num tópico, sobre o projeto do tópico ou não, sem que a
   conversa vire card no Kanban. Um card só nasce quando o usuário pede (`/task`).
2. No Telegram, uma resposta final do agente maior que o limite de uma mensagem
   chega como um arquivo `.md` com o texto completo, em vez de picotada em
   pedaços de 4096 caracteres.

As duas partes são independentes e podem ser entregues separadamente: primeiro o
`.md`, depois o `/chat`.

## O que já existe

- Texto comum num tópico já vira um turno do agente na sessão do tópico
  (`connector-host.ts`, `handleConnectorUserTurn`). Nada transforma texto em card;
  só o `/task` cria card (`utils/chat-commands.ts`).
- Um comando pode entregar um prompt ao turno com `context.submitPrompt`, como o
  `/task --brainstorm` faz (`buildBrainstormPrompt` em `utils/kanban-task.ts`).
- O tópico guarda `cwd`/`workspaceRoot`; o `/task` usa `workspaceRoot || cwd`
  como projeto do card.
- Mudar o prompt de sistema do tópico apaga a sessão (`connector-host.ts`,
  `runtimeConfigChanged` → `clearSession`).
- Respostas finais do Telegram passam por `postTelegramFormattedReply`
  (`adapters/telegram-format.ts`), que corta o texto formatado a cada 4096
  caracteres, inclusive no meio de palavra ou de bloco de código.

## Parte 1 — Resposta longa vira `.md` (Telegram)

### Comportamento

- Vale para toda resposta final do agente no Telegram (o caminho
  `postFinalReply`), não só para o `/chat`. Mensagens de ferramenta/status,
  notificações de card e entregas agendadas não mudam.
- Se o texto formatado couber em uma mensagem (≤ 4096), nada muda.
- Se não couber, o conector envia **uma** mensagem via `sendDocument`:
  - `document`: arquivo `.md` com o texto **original** do agente (o Markdown que
    ele escreveu, não o texto já convertido em entidades), UTF-8.
  - `caption`: o começo da resposta em texto puro, cortado em fronteira de
    palavra, seguido de `… (resposta completa no arquivo)`; o total respeita o
    limite de 1024 caracteres da legenda. Sem `parse_mode` nem entidades.
  - `chat_id` e `message_thread_id` saem de `parseTelegramThreadId`, como hoje.
- Nome do arquivo: o primeiro título Markdown da resposta (`#` a `######`),
  convertido em slug — minúsculas, acentos removidos, só `a-z0-9` e `-`, no
  máximo 60 caracteres — mais `.md`. Sem título, ou slug vazio:
  `resposta-AAAA-MM-DD-HHmm.md` (hora local).
- Falha no `sendDocument` (rede, resposta `ok: false`): registra um aviso no log
  e cai no envio atual em pedaços, para a resposta nunca se perder.

### Onde mexer

- `apps/cli/src/connectors/adapters/telegram-format.ts`:
  - `buildTelegramDocumentName(text, now)` — nome do arquivo.
  - `buildTelegramDocumentCaption(text)` — legenda.
  - `postTelegramFormattedReply` decide entre `sendMessage` e `sendDocument`
    pelo tamanho do texto formatado; o `sendDocument` usa `FormData` + `Blob`
    pelo mesmo `fetchImpl` injetável, e `readTelegramApiResponse` valida a
    resposta como já faz.

### Testes (`telegram-format.test.ts`, com `fetchImpl` falso)

- Resposta curta continua em um `sendMessage`.
- Resposta longa faz um único `sendDocument`, com o arquivo contendo o texto
  original inteiro, `message_thread_id` do tópico e legenda ≤ 1024.
- Nome vindo do título, com acentos; nome por data quando não há título.
- Falha no `sendDocument` cai no envio em pedaços.

## Parte 2 — Comando `/chat`

### Comportamento

- `/chat <pergunta>` entra como mais uma mensagem na **mesma sessão** do tópico,
  com todo o contexto anterior. Não há modo ligado/desligado nem sessão
  separada.
- A regra de "só conversa" vai **dentro da mensagem**, não no prompt de sistema,
  porque mudar o prompt de sistema apagaria a sessão. O comando monta um prompt
  com `buildChatPrompt` e o entrega com `context.submitPrompt`:

  ```
  Conversa aberta, não uma demanda. Projeto deste tópico: <projectPath>.
  A pergunta pode ser sobre ele ou geral. Pesquise, explique ou processe o que
  for pedido e responda aqui. Não crie card no Kanban, não altere arquivos,
  não faça commit e não rode comandos que mudem estado, a menos que o pedido
  abaixo diga isso explicitamente.

  <pergunta>
  ```

  `projectPath` é `state.workspaceRoot || state.cwd`, igual ao `/task`.
- Foto com legenda `/chat …`: as imagens são salvas por `context.images()` e os
  caminhos listados no prompt para o agente ler, como no `/task --brainstorm`.
  A limpeza é a que já existe para imagens não usadas.
- `/chat` sem texto responde com o uso:
  `Usage: /chat <pergunta> - conversa aberta, sem criar card`.
- Superfície sem `submitPrompt`: responde que não há agente para conversar ali,
  como o `/task --brainstorm`.
- Depois de um `/chat`, um `/task` ou `/task --brainstorm` no mesmo tópico
  aproveita a conversa, porque a sessão é a mesma.
- O `/help` ganha a linha do `/chat`.
- Vale para todos os conectores que usam o host de comandos compartilhado
  (Telegram, Slack, Discord, etc.).

### Limite conhecido

A regra é uma instrução ao modelo, não uma trava: as ferramentas continuam
ligadas como o tópico estiver. Travar a escrita de verdade (sessão em
`mode: "plan"` ou `toolPolicies`) exigiria mudar a configuração da sessão e,
portanto, reiniciá-la, o que contraria o requisito de mesma sessão. Fica fora
deste escopo.

### Onde mexer

- `apps/cli/src/utils/chat-commands.ts`: registrar `/chat`, linha no `/help`.
- `apps/cli/src/utils/chat-prompt.ts` (novo, pequeno): `buildChatPrompt`.
- `apps/cli/src/connectors/adapters/telegram.md`: documentar `/chat` e o `.md`.

### Testes

- `chat-commands.test.ts`: `/chat texto` chama `submitPrompt` com a pergunta e
  o caminho do projeto, sem chamar `createKanbanTask`; `/chat` vazio responde o
  uso; sem `submitPrompt` responde a recusa; `/help` lista `/chat`.
- Teste de `buildChatPrompt`: pergunta, projeto e caminhos de imagem presentes.

## Fora do escopo

- Pasta neutra para tópicos sem projeto (a sessão é a do tópico, com o `cwd`
  dele).
- Botão "Virar card" na resposta do `/chat`.
- Arquivo `.md` nos outros conectores.
