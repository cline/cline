import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { setClineDir, setHomeDir } from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalRuntimeHost } from "../../runtime/host/local-runtime-host";
import * as Marketplace from "../../services/marketplace";
import { FileSessionService } from "../../session/services/file-session-service";
import { hasActiveHubSessions } from "../client";
import { BrowserHubClient } from "../client/browser-client";
import { createHubSkillsApi } from "../client/skills";
import { createInMemoryHubOwnerContext } from "../discovery";
import { HubServerTransport } from "./hub-server-transport";
import { startHubWebSocketServer } from "./hub-websocket-server";

let root: string;
let transport: HubServerTransport;
let api: ReturnType<typeof createHubSkillsApi>;
let stopped = false;
const send = vi.fn();
const entry = {
	id: "review-team",
	type: "skill" as const,
	name: "Review",
	install: { args: ["github.com/cline/skills@review-team"] },
};
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "hub-skills-"));
	vi.stubEnv("HOME", root);
	vi.stubEnv("CLINE_DIR", join(root, ".cline"));
	setHomeDir(root);
	setClineDir(join(root, ".cline"));
	vi.spyOn(Marketplace, "fetchMarketplaceCatalog").mockResolvedValue({
		entries: [entry],
	});
	transport = new HubServerTransport({
		sessionHost: new LocalRuntimeHost({
			sessionService: new FileSessionService(join(root, "sessions")),
		}),
		runtimeHandlers: {
			startSession: vi.fn(),
			sendSession: vi.fn(),
			abortSession: vi.fn(),
			stopSession: vi.fn(),
		},
		workspaceRoot: root,
		eventLog: false,
		runQueue: false,
		sessionSearchOptions: { dbPath: ":memory:" },
	});
	stopped = false;
	send.mockReset();
	send.mockImplementation((command, payload) =>
		transport.handleCommand({
			version: "v1",
			clientId: "test",
			command,
			payload,
		}),
	);
	api = createHubSkillsApi({ command: send });
});
afterEach(async () => {
	if (!stopped) await transport.stop();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	setHomeDir(process.env.HOME || homedir());
	setClineDir(process.env.CLINE_DIR || join(homedir(), ".cline"));
	await rm(root, { recursive: true, force: true });
});
async function skill(dir: string) {
	await mkdir(dir, { recursive: true });
	const file = join(dir, "SKILL.md");
	await writeFile(file, "# Review");
	return file;
}
describe("Hub skill management", () => {
	it("uses canonical catalog arguments and reports installed state", async () => {
		const install = vi
			.spyOn(Marketplace, "installMarketplaceSkill")
			.mockImplementation(async (actual) => {
				await skill(join(root, ".agents", "skills", "review-team"));
				return {
					id: actual.id,
					type: "skill",
					status: "installed",
					message: "Installed",
				};
			});
		expect(await api.status([entry.id])).toEqual({ installedIds: [] });
		await api.install(entry.id);
		expect(install).toHaveBeenCalledWith(entry);
		expect(await api.status([entry.id, "unknown"])).toEqual({
			installedIds: [entry.id],
		});
		expect(send).toHaveBeenCalledWith(
			"skills.marketplace.install",
			{ id: entry.id },
			undefined,
			{ retryAfterDispatch: false, timeoutMs: null },
		);
		await expect(api.install("unknown")).rejects.toThrow("not found");
		expect(
			await transport.handleCommand({
				version: "v1",
				command: "skills.marketplace.install",
				payload: { id: entry.id, install: { args: ["evil"] } },
			}),
		).toMatchObject({ ok: false, error: { code: "invalid_payload" } });
	});
	it("supports authenticated browser clients over the direct Hub socket", async () => {
		const server = await startHubWebSocketServer({
			host: "127.0.0.1",
			port: 0,
			owner: createInMemoryHubOwnerContext("skills-wire"),
			sessionHost: new LocalRuntimeHost({
				sessionService: new FileSessionService(join(root, "wire-sessions")),
			}),
			runtimeHandlers: {
				startSession: vi.fn(),
				sendSession: vi.fn(),
				abortSession: vi.fn(),
				stopSession: vi.fn(),
			},
			workspaceRoot: root,
			eventLog: false,
			runQueue: false,
			sessionSearchOptions: { dbPath: ":memory:" },
		});
		const client = new BrowserHubClient(async () => ({
			url: server.url,
			authToken: server.authToken,
			workspaceRoot: root,
		}));
		try {
			await client.connect();
			const connected = createHubSkillsApi(client);
			const file = await skill(join(root, ".agents", "skills", entry.id));
			expect(await connected.status([entry.id])).toEqual({
				installedIds: [entry.id],
			});
			await connected.remove({ path: file });
			expect(existsSync(file)).toBe(false);
		} finally {
			await client.dispose();
			await server.close();
		}
	});

	it.each([
		"skills.marketplace.status",
		"skills.marketplace.install",
		"skills.marketplace.uninstall",
		"skills.remove",
	] as const)("requires registered token authority for %s", async (command) => {
		expect(
			await transport.handleCommand({ version: "v1", command }, null),
		).toMatchObject({ ok: false, error: { code: "client_not_registered" } });
		expect(
			await transport.handleCommand(
				{ version: "v1", command },
				{ clientId: "browser", tokenAuthenticated: false },
			),
		).toMatchObject({ ok: false, error: { code: "authentication_required" } });
	});
	it("removes a configured skill while rejecting unrelated and relative files", async () => {
		const dir = join(root, ".agents", "skills", "local");
		const path = await skill(dir);
		await api.remove({ path });
		expect(existsSync(dir)).toBe(false);
		const outside = await skill(join(root, "outside"));
		await expect(api.remove({ path: outside })).rejects.toThrow("configured");
		expect(existsSync(outside)).toBe(true);
		await expect(api.remove({ path: "SKILL.md" })).rejects.toThrow("absolute");
		await expect(
			api.remove({ path: join(root, ".agents", "skills", "README.md") }),
		).rejects.toThrow("SKILL.md");
	});
	it("removes workspace skills and a root-level SKILL.md without deleting the configured root", async () => {
		const workspace = join(root, "project");
		const dir = join(workspace, ".cline", "skills", "local");
		const file = await skill(dir);
		const events = vi.fn();
		const unsubscribe = transport.subscribe("skills-view", events);
		try {
			await api.remove({ path: file, workspaceRoot: workspace });
			expect(existsSync(dir)).toBe(false);
			expect(events).toHaveBeenCalledWith(
				expect.objectContaining({
					event: "settings.changed",
					payload: { types: ["skills"] },
				}),
			);
			const globalRoot = join(root, ".agents", "skills");
			const rootFile = await skill(globalRoot);
			await api.remove({ path: rootFile });
			expect(existsSync(globalRoot)).toBe(true);
			expect(existsSync(rootFile)).toBe(false);
		} finally {
			unsubscribe();
		}
	});

	it.skipIf(process.platform === "win32")(
		"removes a target symlink without its source and rejects symlinked parent escapes",
		async () => {
			const outside = join(root, "outside");
			await skill(join(outside, "nested"));
			const skills = join(root, ".agents", "skills");
			await mkdir(skills, { recursive: true });
			const link = join(skills, "linked");
			await symlink(outside, link, "dir");
			await expect(
				api.remove({ path: join(link, "nested", "SKILL.md") }),
			).rejects.toThrow("symlink");
			expect(existsSync(join(outside, "nested", "SKILL.md"))).toBe(true);
			await skill(outside);
			await api.remove({ path: join(link, "SKILL.md") });
			expect(existsSync(link)).toBe(false);
			expect(existsSync(join(outside, "SKILL.md"))).toBe(true);
		},
	);
	it("serializes mutations, counts accepted requests, refuses draining work, and waits on shutdown", async () => {
		let finish!: (value: Marketplace.MarketplaceActionResult) => void;
		const pending = new Promise<Marketplace.MarketplaceActionResult>(
			(resolve) => {
				finish = resolve;
			},
		);
		const install = vi
			.spyOn(Marketplace, "installMarketplaceSkill")
			.mockReturnValue(pending);
		const uninstall = vi
			.spyOn(Marketplace, "uninstallMarketplaceSkill")
			.mockResolvedValue({
				id: entry.id,
				type: "skill",
				status: "uninstalled",
				message: "Removed",
			});
		const installing = api.install(entry.id);
		await vi.waitFor(() => expect(install).toHaveBeenCalled());
		const removing = api.uninstall(entry.id);
		expect(uninstall).not.toHaveBeenCalled();
		const activity = await transport.handleCommand({
			version: "v1",
			command: "session.list",
		});
		expect(activity.payload?.activeSkillRequests).toBe(2);
		expect(hasActiveHubSessions(activity.payload)).toBe(true);
		const status = await transport.handleCommand({
			version: "v1",
			command: "hub.status",
		});
		expect(status.payload?.activeSkillRequests).toBe(2);
		await transport.handleCommand({ version: "v1", command: "hub.drain" });
		for (const action of [
			() => api.install(entry.id),
			() => api.uninstall(entry.id),
			() => api.remove({ path: "/tmp/SKILL.md" }),
		])
			await expect(action()).rejects.toMatchObject({ code: "hub_draining" });
		const done = vi.fn();
		const stopping = transport.stop().then(done);
		await Promise.resolve();
		expect(done).not.toHaveBeenCalled();
		finish({
			id: entry.id,
			type: "skill",
			status: "installed",
			message: "Installed",
		});
		await installing;
		await removing;
		await stopping;
		stopped = true;
		expect(uninstall).toHaveBeenCalledWith(entry);
	});
});
