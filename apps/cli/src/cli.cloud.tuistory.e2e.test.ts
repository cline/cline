import { execFile } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { launchTerminal, type Session } from "tuistory";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachCloudHubFixture } from "./tests/cloud-hub-fixture";

const cliRoot = path.resolve(__dirname, "..");
const directories: string[] = [];
const terminals: Session[] = [];
const servers: Server[] = [];
const hubs: ReturnType<typeof attachCloudHubFixture>[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
	for (const terminal of terminals.splice(0)) terminal.close();
	for (const hub of hubs.splice(0)) await hub.close();
	for (const server of servers.splice(0)) {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

async function fixture(
	enabled: boolean | undefined,
	configuredLocalProvider = false,
	legacyOptIn?: boolean,
	withHub = false,
	allowCreate = false,
	paginatedBranches: boolean | "hold-first" = false,
	handoff?: "clean" | "dirty",
) {
	const requests: Array<{
		method: string;
		pathname: string;
		authorization?: string;
		body?: unknown;
	}> = [];
	let created = false;
	const server = createServer(async (request, response) => {
		const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		const body = chunks.length
			? JSON.parse(Buffer.concat(chunks).toString())
			: undefined;
		requests.push({
			method: request.method ?? "GET",
			pathname,
			authorization: request.headers.authorization,
			body,
		});
		response.setHeader("Content-Type", "application/json");
		if (pathname === "/flags/" || pathname === "/decide/") {
			response.end(
				JSON.stringify({
					featureFlags:
						enabled === undefined ? {} : { "cli-cloud-agents": enabled },
					featureFlagPayloads: {},
				}),
			);
			return;
		}
		if (
			allowCreate &&
			request.method === "POST" &&
			pathname === "/api/v1/session"
		) {
			created = true;
			response.end(
				JSON.stringify({
					success: true,
					data: { sessionId: "fixture-created", status: "ready" },
				}),
			);
			return;
		}
		if (
			withHub &&
			request.method === "PATCH" &&
			[
				"/api/v1/session/fixture-task",
				"/api/v1/session/fixture-created",
			].includes(pathname)
		) {
			response.end(JSON.stringify({ success: true, data: {} }));
			return;
		}
		if (request.method !== "GET") {
			response.writeHead(405);
			response.end(
				JSON.stringify({
					success: false,
					error: "Fixture prohibits mutations",
				}),
			);
			return;
		}
		if (pathname === "/api/v1/users/me") {
			response.end(
				JSON.stringify({
					success: true,
					data: {
						id: "fixture-user",
						email: "cloud-fixture@example.test",
						organizations: [],
					},
				}),
			);
			return;
		}
		if (withHub && pathname === "/api/v1/integrations/github/repositories") {
			response.end(
				JSON.stringify({
					success: true,
					data: [
						{
							id: 1,
							full_name: "test/repo",
							html_url: "https://github.com/test/repo",
							default_branch: "main",
						},
					],
				}),
			);
			return;
		}
		if (
			withHub &&
			pathname === "/api/v1/integrations/github/repositories/1/branches"
		) {
			if (paginatedBranches) {
				if (paginatedBranches === "hold-first") return;
				const params = new URL(request.url ?? "/", "http://127.0.0.1")
					.searchParams;
				if (params.get("cursor")) return; // A later page never responds.
				response.end(
					JSON.stringify({
						success: true,
						data: {
							items: params.get("query")
								? [{ name: "release-target" }]
								: [{ name: "main" }],
							nextToken: params.get("query") ? "" : "slow-page",
						},
					}),
				);
				return;
			}
			response.end(
				JSON.stringify({
					success: true,
					data: [{ name: "main" }, { name: "test-branch" }],
				}),
			);
			return;
		}
		if (withHub && pathname === "/api/v1/ai/cline/models") {
			response.end(
				JSON.stringify({
					data: [{ id: "fixture-model", name: "Fixture cloud model" }],
				}),
			);
			return;
		}
		if (withHub && pathname === "/api/v1/ai/cline/recommended-models") {
			response.end(
				JSON.stringify({
					recommended: [{ id: "fixture-model", name: "Fixture cloud model" }],
					free: [],
				}),
			);
			return;
		}
		if (pathname === "/api/v1/session") {
			response.end(
				JSON.stringify({
					success: true,
					data: [
						{
							id: created ? "fixture-created" : "fixture-task",
							title: "Fixture cloud task",
							status: "ready",
							sandboxUrl: "",
							repoContext: {
								repoUrl: "https://github.com/test/repo",
								branch: "main",
							},
							metadata: {
								modelId: "fixture-model",
								...(withHub && !allowCreate ? { taskId: "fixture-inner" } : {}),
							},
							createdAt: "2026-09-15T00:00:00Z",
							updatedAt: "2026-09-15T00:00:00Z",
						},
					],
				}),
			);
			return;
		}
		response.writeHead(404);
		response.end(
			JSON.stringify({ success: false, error: "Unknown fixture route" }),
		);
	});
	const hub = withHub ? attachCloudHubFixture(server, allowCreate) : undefined;
	if (hub) hubs.push(hub);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	servers.push(server);
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("No local fixture port");
	const baseUrl = `http://127.0.0.1:${address.port}`;
	const directory = mkdtempSync(path.join(tmpdir(), "cli-cloud-pty-"));
	directories.push(directory);
	const dataDir = path.join(directory, "data");
	const homeDir = path.join(directory, "home");
	mkdirSync(path.join(dataDir, "settings"), { recursive: true });
	mkdirSync(homeDir);
	const providerPath = path.join(dataDir, "settings", "providers.json");
	writeFileSync(
		providerPath,
		JSON.stringify({
			version: 1,
			providers: {
				...(handoff
					? {
							anthropic: {
								updatedAt: "2026-09-15T00:00:00Z",
								tokenSource: "manual",
								settings: {
									provider: "anthropic",
									apiKey: "fixture-local-key",
									baseUrl,
								},
							},
						}
					: {}),
				cline: {
					updatedAt: "2026-09-15T00:00:00Z",
					tokenSource: "manual",
					settings: {
						provider: "cline",
						apiKey: "fixture-cloud-token",
						baseUrl,
					},
				},
			},
		}),
		{ mode: 0o600 },
	);
	if (legacyOptIn !== undefined) {
		writeFileSync(
			path.join(dataDir, "settings", "cli-cloud.json"),
			JSON.stringify({ version: 1, cloudSessionsEnabled: legacyOptIn }),
			{ mode: 0o600 },
		);
	}
	const cleared = Object.fromEntries(
		Object.keys(process.env)
			.filter((key) => /API_KEY|TOKEN|SECRET|AUTH|^CLINE_/.test(key))
			.map((key) => [key, undefined]),
	);
	const env: Record<string, string | undefined> = {
		...cleared,
		HOME: homeDir,
		CLINE_DATA_DIR: dataDir,
		CLINE_DB_DATA_DIR: path.join(dataDir, "db"),
		CLINE_SESSION_DATA_DIR: path.join(dataDir, "sessions"),
		CLINE_TEAM_DATA_DIR: path.join(dataDir, "teams"),
		CLINE_PROVIDER_SETTINGS_PATH: providerPath,
		CLINE_HOOKS_LOG_PATH: path.join(dataDir, "logs", "hooks.jsonl"),
		CLINE_SESSION_BACKEND_MODE: "local",
		CLINE_API_BASE_URL: baseUrl,
		CLINE_CLI_CLOUD_AGENTS: "1", // The obsolete bypass must have no effect.
		TELEMETRY_SERVICE_API_KEY: "phc_fixture",
		CLINE_TEST_POSTHOG_URL: baseUrl,
		IS_TEST: undefined,
		E2E_TEST: undefined,
		CLINE_TELEMETRY_DISABLED: "1",
		CLINE_NO_AUTO_UPDATE: "1",
		CLINE_DISABLE_CLINE_PASS_NOTICE: "1",
		CI: undefined,
		VITEST: undefined,
	};
	let cwd = cliRoot;
	let headSha: string | undefined;
	if (handoff) {
		cwd = path.join(directory, "repository");
		mkdirSync(cwd);
		const gitEnv = {
			...process.env,
			...env,
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_CONFIG_GLOBAL: "/dev/null",
		};
		const git = (...args: string[]) =>
			execFileAsync("git", args, { cwd, env: gitEnv });
		await git("init", "-b", "main");
		await git("config", "user.name", "Cloud fixture");
		await git("config", "user.email", "fixture@example.test");
		writeFileSync(path.join(cwd, "README.md"), "Local handoff fixture\n");
		writeFileSync(path.join(cwd, ".gitignore"), ".cline/\n");
		await git("add", ".");
		await git("commit", "-m", "Fixture baseline");
		await git("remote", "add", "origin", "https://github.com/test/repo.git");
		await git("config", "branch.main.remote", "origin");
		await git("config", "branch.main.merge", "refs/heads/main");
		headSha = (await git("rev-parse", "HEAD")).stdout.trim();
		const realGit = (await execFileAsync("which", ["git"])).stdout.trim();
		const bin = path.join(directory, "bin");
		mkdirSync(bin);
		const shim = path.join(bin, "git");
		const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
		// Only the remote network read is replaced; all local Git validation is real.
		writeFileSync(
			shim,
			`#!/bin/sh\nif [ "$1" = "ls-remote" ]; then\n  printf '%s\\trefs/heads/main\\n' ${shellQuote(headSha)}\n  exit 0\nfi\nexec ${shellQuote(realGit)} "$@"\n`,
		);
		chmodSync(shim, 0o755);
		env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
		env.GIT_CONFIG_NOSYSTEM = "1";
		env.GIT_CONFIG_GLOBAL = "/dev/null";
		await execFileAsync(
			process.env.BUN_EXEC_PATH ?? "bun",
			[path.join(cliRoot, "src/tests/seed-cloud-handoff-session.ts")],
			{
				cwd,
				env: { ...process.env, ...env },
				timeout: 30_000,
			},
		);
		if (handoff === "dirty")
			writeFileSync(path.join(cwd, "uncommitted.txt"), "Do not transfer me\n");
	}
	const terminal = await launchTerminal({
		command: process.env.BUN_EXEC_PATH ?? "bun",
		args: [
			"--preload",
			path.join(cliRoot, "src/tests/cloud-posthog-preload.ts"),
			path.join(cliRoot, "src", "index.ts"),
			"--provider",
			"anthropic",
			"-m",
			"claude-sonnet-4-6",
			...(configuredLocalProvider ? ["-k", "fixture-local-key"] : []),
			...(handoff ? ["--id", "fixture-local-handoff"] : []),
		],
		cwd,
		env,
		cols: 100,
		rows: 30,
		waitForDataTimeout: 30_000,
	});
	terminals.push(terminal);
	return { terminal, requests, hub, headSha };
}

describe("cloud CLI terminal integration (local fixture only)", () => {
	it("hands off an existing local conversation and attaches the verified remote transcript", async () => {
		const { terminal, requests, hub, headSha } = await fixture(
			true,
			true,
			undefined,
			true,
			true,
			false,
			"clean",
		);
		if (!hub) throw new Error("Missing Hub fixture");
		await terminal.waitForText(
			"The local plan is ready to continue remotely.",
			{ timeout: 30_000 },
		);
		await terminal.type("/cloud");
		await terminal.press("enter");
		await terminal.waitForText("Continue this conversation in cloud");
		await terminal.press("enter");
		await terminal.waitForText("Continue this conversation in cloud?");
		expect(await terminal.text()).toContain(
			`Branch: main · ${headSha?.slice(0, 8)}`,
		);
		expect((await terminal.text()).replace(/\s+/g, " ")).toContain(
			"claude-sonnet-4-6 → fixture-model (cloud fallback)",
		);
		expect(
			requests.filter(
				(request) =>
					request.method === "POST" && request.pathname === "/api/v1/session",
			),
		).toHaveLength(0);
		await terminal.press("y");
		await terminal.waitForText(
			"The local plan is ready to continue remotely.",
			{ timeout: 30_000 },
		);
		expect(await terminal.text()).toContain(
			"Preserve the local handoff context.",
		);
		expect(await terminal.text()).toContain("connected");
		const creations = hub.commands.filter(
			(command) => command.command === "session.create",
		);
		expect(creations).toHaveLength(1);
		expect(creations[0].payload.initialMessages).toMatchObject([
			{ role: "user", content: "Preserve the local handoff context." },
			{
				role: "assistant",
				content: "The local plan is ready to continue remotely.",
			},
		]);
		expect(hub.messages).toEqual(creations[0].payload.initialMessages);
		expect(
			hub.commands.some(
				(command, index) =>
					command.command === "session.messages" &&
					index > hub.commands.indexOf(creations[0]),
			),
		).toBe(true);
		expect(
			hub.commands.filter(
				(command) => command.command === "session.send_input",
			),
		).toHaveLength(0);
		expect(
			requests.filter(
				(request) =>
					request.method === "POST" && request.pathname === "/api/v1/session",
			),
		).toHaveLength(1);
		await terminal.type("/local");
		await terminal.press("enter");
		await terminal.text({
			waitFor: (text) => !text.includes("Cloud · cloud-fixture@example.test"),
			timeout: 10_000,
		});
		await terminal.type("This must not start another local turn.");
		await terminal.press("enter");
		await terminal.waitForText("This conversation continued in cloud:");
		expect(
			requests.filter(
				(request) =>
					request.method === "POST" && request.pathname.endsWith("/messages"),
			),
		).toHaveLength(0);
		await terminal.type("/quit");
		await terminal.press("enter");
		expect(await terminal.waitForExit(10_000)).toBe(true);
	});

	it("rejects handoff from a dirty worktree before creating a cloud session", async () => {
		const { terminal, requests, hub } = await fixture(
			true,
			true,
			undefined,
			true,
			true,
			false,
			"dirty",
		);
		await terminal.waitForText(
			"The local plan is ready to continue remotely.",
			{ timeout: 30_000 },
		);
		await terminal.type("/cloud");
		await terminal.press("enter");
		await terminal.waitForText("Continue this conversation in cloud");
		await terminal.press("enter");
		await terminal.waitForText(
			"Commit and push local changes before handing off to cloud.",
		);
		expect(await terminal.text()).toContain("uncommitted.txt");
		expect(
			requests.filter(
				(request) =>
					request.method === "POST" && request.pathname === "/api/v1/session",
			),
		).toHaveLength(0);
		expect(
			hub?.commands.filter((command) => command.command === "session.create"),
		).toHaveLength(0);
		await terminal.type("/quit");
		await terminal.press("enter");
		expect(await terminal.waitForExit(10_000)).toBe(true);
	});

	it("can start on the repository default while the first branch request is stalled", async () => {
		const { terminal, requests } = await fixture(
			true,
			true,
			undefined,
			true,
			true,
			"hold-first",
		);
		await terminal.waitForText("What can I do for you?", { timeout: 30_000 });
		await terminal.type("/cloud");
		await terminal.press("enter");
		await terminal.waitForText("Fixture cloud task");
		await terminal.press(["ctrl", "n"]);
		await terminal.waitForText("Model: Fixture cloud model", {
			timeout: 15_000,
		});
		await terminal.type("Start with the default branch");
		await terminal.press("tab");
		await terminal.press("enter");
		await terminal.waitForText("Cloud repository");
		await terminal.press("enter");
		await terminal.waitForText("Branch: main", { timeout: 3_000 });
		await terminal.press("enter");
		await terminal.waitForText("Working on the remote fixture.", {
			timeout: 5_000,
		});
		expect(
			requests.find(
				(request) =>
					request.method === "POST" && request.pathname === "/api/v1/session",
			)?.body,
		).toMatchObject({ branch: "main" });
		await terminal.type("/quit");
		await terminal.press("enter");
		expect(await terminal.waitForExit(10_000)).toBe(true);
	});

	it("uses the default branch without waiting for every page and searches remotely", async () => {
		const { terminal, requests, hub } = await fixture(
			true,
			true,
			undefined,
			true,
			true,
			true,
		);
		if (!hub) throw new Error("Missing Hub fixture");
		await terminal.waitForText("What can I do for you?", { timeout: 30_000 });
		await terminal.type("/cloud");
		await terminal.press("enter");
		await terminal.waitForText("Fixture cloud task");
		await terminal.press(["ctrl", "n"]);
		await terminal.waitForText("Model: Fixture cloud model", {
			timeout: 15_000,
		});
		await terminal.type("Use a branch beyond the first page");
		await terminal.press("tab");
		await terminal.press("enter");
		await terminal.waitForText("Cloud repository");
		await terminal.press("enter");
		await terminal.waitForText("Branch: main", { timeout: 3_000 });
		await terminal.press("tab");
		await terminal.press("tab");
		await terminal.press("enter");
		await terminal.waitForText("Starting branch");
		await terminal.type("release-target");
		await terminal.waitForText("> release-target", { timeout: 5_000 });
		await terminal.press("enter");
		await terminal.waitForText("Branch: release-target");
		await terminal.press("enter");
		await terminal.waitForText("Working on the remote fixture.", {
			timeout: 15_000,
		});
		expect(
			requests.find(
				(request) =>
					request.method === "POST" && request.pathname === "/api/v1/session",
			)?.body,
		).toMatchObject({ branch: "release-target" });
		await terminal.type("/quit");
		await terminal.press("enter");
		expect(await terminal.waitForExit(10_000)).toBe(true);
	});

	it("opens /cloud and starts a task from the composer with keyboard actions", async () => {
		const { terminal, requests, hub } = await fixture(
			true,
			true,
			undefined,
			true,
			true,
		);
		if (!hub) throw new Error("Missing Hub fixture");
		await terminal.waitForText("What can I do for you?", { timeout: 30_000 });
		await terminal.type("/cloud");
		await terminal.press("enter");
		await terminal.waitForText("Fixture cloud task");
		await terminal.press(["ctrl", "n"]);
		await terminal.waitForText("What would you like to build?");
		await terminal.waitForText("Model: Fixture cloud model", {
			timeout: 15_000,
		});
		await terminal.type("Build a fixture feature");
		await terminal.press("tab");
		await terminal.press("enter");
		await terminal.waitForText("Cloud repository");
		await terminal.press("enter");
		await terminal.waitForText("Branch: main");
		expect(await terminal.text()).toContain("Tools: Manual approval");
		expect(await terminal.text()).toContain("Build a fixture feature");
		await terminal.press("enter");
		await terminal.waitForText("Working on the remote fixture.", {
			timeout: 15_000,
		});
		const posts = requests.filter(
			(request) =>
				request.method === "POST" && request.pathname === "/api/v1/session",
		);
		expect(posts).toHaveLength(1);
		expect(posts[0].body).toMatchObject({
			repoUrl: "https://github.com/test/repo",
			branch: "main",
			modelId: "fixture-model",
		});
		expect(
			hub.commands.find((command) => command.command === "session.create")
				?.payload.toolPolicies,
		).toEqual({ "*": { autoApprove: false } });
		expect(
			hub.commands.find((command) => command.command === "session.send_input")
				?.payload.prompt,
		).toBe("Build a fixture feature");
		hub.event("approval.requested", {
			approvalId: "fixture-approval",
			toolCallId: "fixture-call",
			toolName: "run_commands",
			inputJson: '{"command":"true"}',
		});
		await terminal.waitForText("Approval 1: run_commands");
		await terminal.press(["ctrl", "p"]);
		await terminal.waitForText("Cloud actions");
		await terminal.type("Approve:");
		await terminal.press("enter");
		await terminal.text({
			waitFor: (text) => !text.includes("Approval 1:"),
			timeout: 15_000,
		});
		expect(
			hub.commands.find((command) => command.command === "approval.respond")
				?.payload.approved,
		).toBe(true);
		await terminal.press(["ctrl", "p"]);
		await terminal.waitForText("Cloud actions");
		await terminal.type("Stop task");
		await terminal.press("enter");
		await terminal.waitForText("Idle");
		await terminal.press(["ctrl", "n"]);
		await terminal.waitForText("Repository: test/repo");
		await terminal.waitForText("Branch: main");
		expect(await terminal.text()).not.toContain("Build a fixture feature");
		await terminal.press("enter");
		await terminal.waitForText("describe your task");
		expect(
			requests.filter(
				(request) =>
					request.method === "POST" && request.pathname === "/api/v1/session",
			),
		).toHaveLength(1);
		await terminal.press("escape");
		await terminal.type("/local");
		await terminal.press("enter");
		await terminal.waitForText("What can I do for you?");
		await terminal.press(["ctrl", "c"]);
		expect(await terminal.waitForExit(10_000)).toBe(true);
	});

	it("streams, approves, queues, reconnects, stops, and detaches through the TUI", async () => {
		const { terminal, hub } = await fixture(true, true, undefined, true);
		if (!hub) throw new Error("Missing Hub fixture");
		const submit = async (text: string) => {
			await terminal.type(text);
			await terminal.press("enter");
		};
		await terminal.waitForText("What can I do for you?", { timeout: 30_000 });
		await submit("/cloud");
		await terminal.waitForText("Fixture cloud task");
		await submit("/open 1");
		await terminal.waitForText("Cloud message (literal text)", {
			timeout: 15_000,
		});
		const prompt = "Inspect @./local-secret.txt literally";
		await submit(prompt);
		await terminal.waitForText("Working on the remote fixture.");
		expect(
			hub.commands.find((item) => item.command === "session.send_input")
				?.payload,
		).toEqual({ prompt });
		hub.event("approval.requested", {
			approvalId: "fixture-approval",
			toolCallId: "fixture-call",
			toolName: "run_commands",
			inputJson: '{"command":"true"}',
		});
		await terminal.waitForText("Approval 1: run_commands");
		await submit("/approve 1");
		await terminal.text({
			waitFor: (text) => !text.includes("Approval 1:"),
			timeout: 15_000,
		});
		expect(
			hub.commands.find((item) => item.command === "approval.respond")?.payload,
		).toMatchObject({ approvalId: "fixture-approval", approved: true });
		await submit("Queued follow-up");
		await terminal.waitForText("Queue 1: Queued follow-up");
		expect(
			hub.commands
				.filter((item) => item.command === "session.send_input")
				.at(-1)?.payload,
		).toEqual({ prompt: "Queued follow-up", delivery: "queue" });
		hub.disconnect();
		await vi.waitFor(() => expect(hub.connections).toHaveLength(2), {
			timeout: 15_000,
		});
		await terminal.waitForText("Cloud message (literal text)", {
			timeout: 15_000,
		});
		expect(await terminal.text()).toContain("Working on the remote fixture.");
		expect(await terminal.text()).toContain("Queue 1: Queued follow-up");
		expect(
			hub.commands.filter((item) => item.command === "session.send_input"),
		).toHaveLength(2);
		expect(
			hub.connections.every(
				(item) => item.authorization === "Bearer fixture-cloud-token",
			),
		).toBe(true);
		await submit("/remove 1");
		await terminal.text({
			waitFor: (text) => !text.includes("Queue 1:"),
			timeout: 15_000,
		});
		await submit("/stop");
		await terminal.waitForText("Idle");
		expect(
			hub.commands.filter((item) => item.command === "run.abort"),
		).toHaveLength(1);
		await submit("Keep running after detach");
		await terminal.waitForText("Running");
		await submit("/cloud");
		await terminal.waitForText("Fixture cloud task");
		await submit("/quit");
		expect(await terminal.waitForExit(10_000)).toBe(true);
		expect(
			hub.commands.filter((item) => item.command === "run.abort"),
		).toHaveLength(1);
	});

	it("opens /cloud directly for an eligible account and quits without a cloud mutation", async () => {
		const { terminal, requests } = await fixture(true, true);
		await terminal.waitForText("What can I do for you?", { timeout: 30_000 });
		await terminal.type("/cloud");
		await terminal.press("enter");
		await terminal.waitForText("Fixture cloud task", { timeout: 15_000 });
		expect(await terminal.text()).toContain("cloud-fixture@example.test");
		expect(
			requests.some(
				(request) =>
					request.pathname === "/api/v1/session" &&
					request.authorization === "Bearer fixture-cloud-token",
			),
		).toBe(true);
		await terminal.type("/quit");
		await terminal.press("enter");
		expect(await terminal.waitForExit(10_000)).toBe(true);
		expect(
			requests
				.filter((request) => request.pathname.startsWith("/api/"))
				.every((request) => request.method === "GET"),
		).toBe(true);
	});

	it("ignores obsolete Preview settings and opens cloud directly", async () => {
		const { terminal, requests } = await fixture(true, true, false);
		await terminal.waitForText("What can I do for you?", { timeout: 30_000 });
		await terminal.type("/cloud");
		await terminal.press("enter");
		await terminal.waitForText("Fixture cloud task", { timeout: 15_000 });
		expect(await terminal.text()).not.toContain("/preview");
		expect(
			requests.some((request) => request.pathname === "/api/v1/session"),
		).toBe(true);
		await terminal.type("/quit");
		await terminal.press("enter");
		expect(await terminal.waitForExit(10_000)).toBe(true);
	});

	it("opens local history directly from cloud and returns to local chat", async () => {
		const { terminal, requests } = await fixture(true, true);
		await terminal.waitForText("What can I do for you?", { timeout: 30_000 });
		await terminal.type("/cloud");
		await terminal.press("enter");
		await terminal.waitForText("Fixture cloud task", { timeout: 15_000 });
		await terminal.type("/history");
		await terminal.press("enter");
		await terminal.waitForText("No sessions found", { timeout: 15_000 });
		expect(await terminal.text()).not.toContain("Fixture cloud task");
		await terminal.press("escape");
		await terminal.waitForText("What can I do for you?", { timeout: 15_000 });
		await terminal.type("/quit");
		await terminal.press("enter");
		expect(await terminal.waitForExit(10_000)).toBe(true);
		expect(
			requests
				.filter((request) => request.pathname.startsWith("/api/"))
				.every((request) => request.method === "GET"),
		).toBe(true);
	});

	it.each([
		false,
		undefined,
	])("keeps /cloud unavailable for flag=%s even with the old environment override", async (flag) => {
		const { terminal, requests } = await fixture(flag, true);
		await terminal.waitForText("What can I do for you?", { timeout: 30_000 });
		await terminal.type("/cloud");
		await terminal.press("enter");
		await terminal.waitForText("Cloud agents are unavailable", {
			timeout: 15_000,
		});
		expect(
			requests.some((request) => request.pathname === "/api/v1/session"),
		).toBe(false);
		await terminal.type("/quit");
		await terminal.press("enter");
		expect(await terminal.waitForExit(10_000)).toBe(true);
		expect(
			requests
				.filter((request) => request.pathname.startsWith("/api/"))
				.every((request) => request.method === "GET"),
		).toBe(true);
	});
});
