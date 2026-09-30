import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve as resolvePath } from "node:path";
import { createInterface } from "node:readline";
import { expect, type Page, test } from "@playwright/test";

// Use the desktop's real browser-to-sidecar protocol, never route/mock session
// commands. This exercises sidecar -> Hub -> runtime -> storage -> model.
async function invoke(
	page: Page,
	endpoint: string,
	command: string,
	args: object,
) {
	return page.evaluate(
		({ endpoint, command, args }) =>
			new Promise<Record<string, unknown>>((resolve, reject) => {
				const socket = new WebSocket(endpoint);
				const timeout = setTimeout(() => {
					socket.close();
					reject(new Error(`${command} timed out`));
				}, 30_000);
				socket.onopen = () =>
					socket.send(
						JSON.stringify({ type: "command", id: "e2e", command, args }),
					);
				socket.onerror = () => {
					clearTimeout(timeout);
					socket.close();
					reject(new Error("Sidecar connection failed"));
				};
				socket.onmessage = (event) => {
					const reply = JSON.parse(event.data);
					if (reply.type !== "response" || reply.id !== "e2e") return;
					clearTimeout(timeout);
					socket.close();
					if (reply.ok) resolve(reply.result);
					else reject(new Error(reply.error));
				};
			}),
		{ endpoint, command, args },
	);
}

test("continues a resident session after desktop relaunch and CLI resume", async ({
	page,
	request,
}) => {
	test.setTimeout(180_000);
	const root = await mkdtemp(resolvePath(tmpdir(), "cline-resident-e2e-"));
	const child = spawn(
		"bun",
		[resolvePath(__dirname, "fixtures/resident-session-server.ts")],
		{
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, CLINE_E2E_ROOT: root },
		},
	);
	let logs = "";
	let controlUrl: string | undefined;
	child.stderr.on("data", (data) => {
		logs += data;
	});
	try {
		const fixture = await new Promise<{
			endpoint: string;
			control: string;
			config: Record<string, unknown>;
		}>((resolve, reject) => {
			const timeout = setTimeout(
				() => reject(new Error(`Fixture startup timed out\n${logs}`)),
				90_000,
			);
			createInterface({ input: child.stdout }).on("line", (line) => {
				try {
					const value = JSON.parse(line);
					if (value.type === "fixture-ready") {
						clearTimeout(timeout);
						resolve(value);
					}
				} catch {
					logs += `${line}\n`;
				}
			});
			child.once("exit", (code) => {
				clearTimeout(timeout);
				reject(new Error(`Fixture exited ${code}\n${logs}`));
			});
		});
		controlUrl = fixture.control;
		// Use an isolated loopback origin allowed by this sidecar fixture.
		await page.goto(String(fixture.config.baseUrl));
		let endpoint = fixture.endpoint;
		const chat = (request: object) =>
			invoke(page, endpoint, "chat_session_command", { request });
		const started = await chat({ action: "start", config: fixture.config });
		const sessionId = started.sessionId;
		expect(sessionId).toBeTruthy();
		const send = async (prompt: string, responseNumber: number) => {
			await chat({ action: "send", sessionId, prompt, config: fixture.config });
			await expect
				.poll(async () =>
					JSON.stringify(
						await invoke(page, endpoint, "read_session_messages", {
							sessionId,
						}),
					),
				)
				.toContain(`Fixture response ${responseNumber}`);
		};
		await send("First desktop prompt", 1);

		// The sidecar exits, but the same Hub (and resident session) stays alive.
		const restarted = await request.post(`${fixture.control}/restart`);
		expect(restarted.ok(), await restarted.text()).toBeTruthy();
		endpoint = (await restarted.json()).endpoint;
		const reopened = await chat({
			action: "start",
			config: { ...fixture.config, sessionId },
		});
		expect(reopened.sessionId).toBe(sessionId); // #14501 fails here: session already exists.
		await send("Desktop prompt after relaunch", 2);

		// A real CLI session client resumes the same ID, and remains connected.
		const resumed = await request.post(`${fixture.control}/cli-resume`, {
			data: { sessionId },
		});
		expect(resumed.ok(), await resumed.text()).toBeTruthy();
		await send("Desktop prompt while CLI is connected", 4);
		const messages = JSON.stringify(
			await invoke(page, endpoint, "read_session_messages", { sessionId }),
		);
		for (const prompt of [
			"First desktop prompt",
			"Desktop prompt after relaunch",
			"Follow-up from CLI",
			"Desktop prompt while CLI is connected",
		]) {
			expect(messages).toContain(prompt);
		}
		const modelRequests = await (
			await request.get(`${fixture.control}/requests`)
		).json();
		expect(modelRequests).toHaveLength(4);
		expect(JSON.stringify(modelRequests[3])).toContain("First desktop prompt");
	} finally {
		if (controlUrl)
			await request
				.post(`${controlUrl}/shutdown`, { timeout: 5_000 })
				.catch(() => undefined);
		await test
			.info()
			.attach("session-backend.log", { body: logs, contentType: "text/plain" });
		child.stdin.end();
		await new Promise<void>((resolve) => {
			if (child.exitCode !== null) return resolve();
			const timeout = setTimeout(() => {
				child.kill("SIGKILL");
				resolve();
			}, 10_000);
			child.once("exit", () => {
				clearTimeout(timeout);
				resolve();
			});
		});
		await rm(root, { recursive: true, force: true });
	}
});
