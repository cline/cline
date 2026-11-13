import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgendaTaskManager } from "@cline/core";
import {
	applyFactoryAutonomyDefaults,
	type BasicLogger,
	FACTORY_BUILT_IN_POLICY,
	factoryTaskConfigSchema,
} from "@cline/shared";

const git = (cwd: string, ...args: string[]) =>
	execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();

/**
 * A git repository with one commit. `origin` is a remote URL only: nothing
 * is pushed or fetched unless it is a local bare repository.
 */
export function createRepo(
	dir: string,
	files: Record<string, string>,
	origin: string | { bare: string },
): void {
	mkdirSync(dir, { recursive: true });
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), content);
	}
	git(dir, "init", "-q", "-b", "main");
	git(dir, "config", "user.email", "eval@example.test");
	git(dir, "config", "user.name", "Factory Eval");
	git(dir, "add", ".");
	git(dir, "commit", "-q", "-m", "Initial commit");
	if (typeof origin === "string") {
		git(dir, "remote", "add", "origin", origin);
		return;
	}
	git(dirname(origin.bare), "init", "-q", "--bare", "-b", "main", origin.bare);
	git(dir, "remote", "add", "origin", origin.bare);
	git(dir, "push", "-q", "origin", "main");
}

/**
 * A new card's Factory config as the `factory` tool builds it with no
 * workflow (the built-in hands-off policy, adaptive review), except that plan
 * approval is required so nothing proceeds past the plan.
 */
export function evalFactoryConfig(
	extra: Record<string, unknown> = {},
): ReturnType<typeof factoryTaskConfigSchema.parse> {
	return factoryTaskConfigSchema.parse(
		applyFactoryAutonomyDefaults({
			...FACTORY_BUILT_IN_POLICY,
			reviewMode: "adaptive",
			approval: "required",
			...extra,
		}),
	);
}

export type CreateTaskInput = Parameters<AgendaTaskManager["createTask"]>[0];

export const quietLogger: BasicLogger = { debug: () => {}, log: () => {} };

/** The scoper's fixture: a small task-list app with api, web, cli and docs areas. */
export const TASK_APP_FILES: Record<string, string> = {
	"package.json": `${JSON.stringify(
		{
			name: "tasklist",
			private: true,
			type: "module",
			scripts: { test: "bun test", start: "bun api/server.ts" },
		},
		null,
		2,
	)}\n`,
	"README.md":
		"# tasklist\n\nA small task list: an HTTP API (`api/`), a web page (`web/`), a command line client (`cli/`) and docs (`docs/`).\n\nRun `bun test` for the tests.\n",
	"api/store.ts": `export interface Task {
	id: number;
	title: string;
	done: boolean;
}

const tasks: Task[] = [];

export function listTasks(): Task[] {
	return [...tasks];
}

export function addTask(title: string): Task {
	const task = { id: tasks.length + 1, title, done: false };
	tasks.push(task);
	return task;
}

export function completeTask(id: number): Task | undefined {
	const task = tasks.find((t) => t.id === id);
	if (task) task.done = true;
	return task;
}
`,
	"api/server.ts": `import { addTask, completeTask, listTasks } from "./store";

export async function handle(request: Request): Promise<Response> {
	const url = new URL(request.url);
	if (url.pathname === "/tasks" && request.method === "GET")
		return Response.json(listTasks());
	if (url.pathname === "/tasks" && request.method === "POST") {
		const body = (await request.json()) as { title?: unknown };
		if (typeof body.title !== "string" || !body.title.trim())
			return new Response("title is required", { status: 400 });
		return Response.json(addTask(body.title.trim()), { status: 201 });
	}
	const done = url.pathname.match(/^\\/tasks\\/(\\d+)\\/done$/);
	if (done && request.method === "POST") {
		const task = completeTask(Number(done[1]));
		return task ? Response.json(task) : new Response("not found", { status: 404 });
	}
	return new Response("not found", { status: 404 });
}

if (import.meta.main) Bun.serve({ port: 3000, fetch: handle });
`,
	"api/server.test.ts": `import { expect, test } from "bun:test";
import { handle } from "./server";

test("creates and lists a task", async () => {
	const created = await handle(
		new Request("http://local/tasks", {
			method: "POST",
			body: JSON.stringify({ title: "Write docs" }),
		}),
	);
	expect(created.status).toBe(201);
	const list = await (await handle(new Request("http://local/tasks"))).json();
	expect(list).toHaveLength(1);
});
`,
	"web/index.html": `<!doctype html>
<html>
	<head>
		<title>Tasks</title>
		<link rel="stylesheet" href="styles.css" />
	</head>
	<body>
		<h1>Tasks</h1>
		<form id="add"><input name="title" /><button>Add</button></form>
		<ul id="tasks"></ul>
		<script type="module" src="app.js"></script>
	</body>
</html>
`,
	"web/app.ts": `const list = document.querySelector("#tasks") as HTMLUListElement;
const form = document.querySelector("#add") as HTMLFormElement;

async function render(): Promise<void> {
	const tasks = (await (await fetch("/tasks")).json()) as {
		id: number;
		title: string;
		done: boolean;
	}[];
	list.innerHTML = tasks
		.map((t) => \`<li class="\${t.done ? "done" : ""}">\${t.title}</li>\`)
		.join("");
}

form.addEventListener("submit", async (event) => {
	event.preventDefault();
	const title = new FormData(form).get("title");
	await fetch("/tasks", { method: "POST", body: JSON.stringify({ title }) });
	form.reset();
	await render();
});

void render();
`,
	"web/styles.css":
		"body { font-family: sans-serif; margin: 2rem; }\n.done { text-decoration: line-through; color: #888; }\n",
	"cli/main.ts": `const base = process.env.TASKS_URL ?? "http://localhost:3000";

async function main(args: string[]): Promise<void> {
	const [command, ...rest] = args;
	if (command === "list") {
		const tasks = (await (await fetch(\`\${base}/tasks\`)).json()) as {
			id: number;
			title: string;
			done: boolean;
		}[];
		console.log(\`Tasks: \${tasks.map((t) => \`\${t.done ? "[x]" : "[ ]"} \${t.title}\`).join("\\n")}\`);
		return;
	}
	if (command === "add") {
		await fetch(\`\${base}/tasks\`, {
			method: "POST",
			body: JSON.stringify({ title: rest.join(" ") }),
		});
		return;
	}
	console.log("usage: tasks list | tasks add <title>");
}

await main(process.argv.slice(2));
`,
	"docs/getting-started.md":
		"# Getting started\n\nRun `bun api/server.ts`, then open `web/index.html`.\n",
	"docs/api.md":
		'# API\n\n- `GET /tasks` lists tasks.\n- `POST /tasks` with `{ "title": string }` creates one. Clients recieve the created task.\n- `POST /tasks/:id/done` marks one done. Clients recieve the updated task.\n',
};
