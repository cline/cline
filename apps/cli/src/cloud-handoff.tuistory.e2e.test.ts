import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchTerminal, type Session } from "tuistory";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

const cliRoot = path.resolve(__dirname, "..");
const fixture = path.join(
	cliRoot,
	"src",
	"tests",
	"fixtures",
	"cloud-handoff-tui.tsx",
);
const bunExec = process.env.BUN_EXEC_PATH ?? "bun";
const sessions: Session[] = [];
const tempDirs: string[] = [];
const timeout = 20_000;
const fixtureStateSchema = z.object({
	preparedDraft: z
		.object({ instruction: z.string(), images: z.array(z.string()) })
		.optional(),
	preparedDrafts: z
		.array(z.object({ instruction: z.string(), images: z.array(z.string()) }))
		.optional(),
	preparedSessionIds: z.array(z.string()).optional(),
	completedTaskIds: z.array(z.string()).optional(),
	retryTargets: z
		.array(
			z.object({
				taskId: z.string(),
				instruction: z.string(),
				images: z.array(z.string()),
			}),
		)
		.optional(),
	started: z.boolean().optional(),
	localPrompts: z.array(z.string()).optional(),
	activeSessionId: z.string().optional(),
	resumeCalls: z.array(z.string()).optional(),
});
type FixtureState = z.infer<typeof fixtureStateSchema>;

type FixtureProvider = "cline" | "cline-pass" | "anthropic" | "openrouter";

function launch(
	fail = false,
	provider: FixtureProvider = "cline",
	extraEnv: Record<string, string | undefined> = {},
) {
	const stateDir = mkdtempSync(path.join(os.tmpdir(), "cloud-handoff-tui-"));
	tempDirs.push(stateDir);
	const statePath = path.join(stateDir, "state.json");
	const sessionPromise = launchTerminal({
		command: bunExec,
		args: [fixture],
		cwd: cliRoot,
		env: {
			HOME: stateDir,
			CLINE_DATA_DIR: path.join(stateDir, "data"),
			CLINE_DB_DATA_DIR: path.join(stateDir, "data", "db"),
			CLINE_SESSION_DATA_DIR: path.join(stateDir, "sessions"),
			CLINE_TEAM_DATA_DIR: path.join(stateDir, "teams"),
			CLINE_PROVIDER_SETTINGS_PATH: path.join(
				stateDir,
				"settings",
				"providers.json",
			),
			CLINE_TELEMETRY_DISABLED: "1",
			CLINE_DISABLE_CLINE_PASS_NOTICE: "1",
			CLINE_NO_AUTO_UPDATE: "1",
			CI: undefined,
			VITEST: undefined,
			CLOUD_HANDOFF_FIXTURE_STATE: statePath,
			CLOUD_HANDOFF_FIXTURE_PROVIDER: provider,
			CLOUD_HANDOFF_FIXTURE_FAIL: fail ? "1" : undefined,
			...extraEnv,
		},
		cols: 120,
		rows: 40,
		waitForDataTimeout: timeout,
	});
	return sessionPromise.then((session) => {
		sessions.push(session);
		return { session, statePath, stateDir };
	});
}

function readState(statePath: string): FixtureState {
	if (!existsSync(statePath)) return {};
	const json: unknown = JSON.parse(readFileSync(statePath, "utf8"));
	return fixtureStateSchema.parse(json);
}

async function saveEvidence(
	label: string,
	session: Session,
	statePath: string,
) {
	const directory = process.env.CLOUD_HANDOFF_E2E_EVIDENCE_DIR;
	if (!directory) return;
	mkdirSync(directory, { recursive: true });
	writeFileSync(path.join(directory, `${label}.txt`), await session.text());
	writeFileSync(
		path.join(directory, `${label}.json`),
		JSON.stringify(readState(statePath), null, 2),
	);
}

function createSyntheticImage(stateDir: string) {
	const bytes = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
		"base64",
	);
	const imagePath = path.join(stateDir, "synthetic.png");
	writeFileSync(imagePath, bytes);
	return {
		imagePath,
		dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
	};
}

async function pasteSyntheticImage(session: Session, imagePath: string) {
	await session.writeRaw(`\u001b[200~${imagePath}\u001b[201~`);
	await session.waitForText("[Image 1]", { timeout });
}

describe("cloud handoff TUI", () => {
	afterEach(async () => {
		for (const session of sessions.splice(0)) session.close();
		for (const dir of tempDirs.splice(0))
			rmSync(dir, { recursive: true, force: true });
	});

	it.each([
		["cline", true],
		["cline-pass", true],
		["anthropic", false],
		["openrouter", false],
	] as const)("shows /cloud for provider %s: %s", async (provider, visible) => {
		const { session } = await launch(false, provider);
		await session.waitForText("Ask anything...", { timeout });
		await session.type("/clo");
		await session.waitForText("/clo", { timeout });
		await session.waitIdle({ timeout: 2_000 });
		const screen = await session.text();
		expect(screen).toContain("/clo");
		expect(screen.includes("/cloud")).toBe(visible);
	});

	it("rejects /cloud in Cloud mode without consuming the draft", async () => {
		const { session, statePath, stateDir } = await launch();
		await session.waitForText("Ask anything...", { timeout });
		const instruction = "continue the synthetic parser task";
		const image = createSyntheticImage(stateDir);
		await session.type(`/cloud ${instruction} `);
		await pasteSyntheticImage(session, image.imagePath);
		await session.press(["ctrl", "o"]);
		await session.text({
			waitFor: (screen) => screen.includes("example/synthetic-project"),
			timeout,
		});
		await session.press("escape");
		await session.text({
			waitFor: (screen) =>
				screen.includes("☁ Choose a repository") &&
				!screen.includes("example/synthetic-project"),
			timeout,
		});
		// The repository picker can leave focus on its overlay after dismissal.
		await session.clickAt(20, 36);
		await session.press("enter");
		await session.waitForText("Use /cloud from a local conversation.", {
			timeout,
		});
		await saveEvidence("cloud-mode-rejection", session, statePath);
		expect(await session.text()).toContain("[Image 1]");
		expect(readState(statePath).preparedDraft).toBeUndefined();
		expect(readState(statePath).started).toBeUndefined();

		await session.press(["ctrl", "o"]);
		await session.waitForText("● Local", { timeout });
		const localScreen = await session.text();
		expect(localScreen).not.toContain("Cloud handoff:");
		expect(localScreen).not.toContain("Restore /cloud draft");
		await session.press("enter");
		await session.waitForText("Continue in cloud?", { timeout });
		expect(readState(statePath).preparedDraft).toEqual({
			instruction,
			images: [image.dataUrl],
		});
		await session.press("escape");
	});

	it("cancels without losing the instruction", async () => {
		const { session, statePath, stateDir } = await launch();
		await session.waitForText("Ask anything...", { timeout });
		const instruction = "continue the synthetic parser task";
		await session.type(`/cloud ${instruction}`);
		const image = createSyntheticImage(stateDir);
		await pasteSyntheticImage(session, image.imagePath);
		await session.press("enter");
		await session.waitForText("Continue in cloud?", { timeout });
		await session.waitForText("1 changed/new files · 1 unpublished commits", {
			timeout,
		});
		await session.press("escape");
		const cancelledDraft = await session.text();
		expect(cancelledDraft).toContain(instruction);
		expect(cancelledDraft).toContain("[Image 1]");
		expect(readState(statePath).started).toBeUndefined();
		expect(readState(statePath).preparedDraft).toEqual({
			instruction,
			images: [image.dataUrl],
		});

		await session.waitIdle({ timeout: 5_000 });
		await session.press("enter");
		await session.waitForText("Continue in cloud?", { timeout });
		expect(readState(statePath).preparedDraft).toEqual({
			instruction,
			images: [image.dataUrl],
		});
		await session.press("escape");
	});

	it("forwards an image and keeps local chat usable while cloud work runs", async () => {
		const { session, statePath, stateDir } = await launch();
		await session.waitForText("Ask anything...", { timeout });
		const instruction = "continue the synthetic parser task";
		const image = createSyntheticImage(stateDir);
		await session.type(`/cloud ${instruction} `);
		await pasteSyntheticImage(session, image.imagePath);
		await session.press("enter");
		await session.waitForText("Continue in cloud?", { timeout });
		await session.press("enter");
		await session.waitForText("Publishing the approved Git snapshot.", {
			timeout,
		});
		expect(readState(statePath).preparedDraft).toEqual({
			instruction,
			images: [image.dataUrl],
		});

		const localPrompt = "keep this follow-up local";
		await session.type(localPrompt);
		await session.press("enter");
		await session.text({
			waitFor: (screen) =>
				screen.includes(localPrompt) &&
				readState(statePath).localPrompts?.includes(localPrompt) === true,
			timeout,
		});
		const duringProvisioning = await session.text();
		expect(duringProvisioning).toContain(
			"Publishing the approved Git snapshot.",
		);
		expect(duringProvisioning).not.toContain("Cloud task ready.");
		expect(readState(statePath).localPrompts).toContain(localPrompt);
		await session.waitForText(
			"Cloud task ready. You can keep working locally.",
			{ timeout },
		);
		await session.waitForText(
			"Open cloud task (Alt+O): https://app.cline.bot/tasks/synthetic-task",
			{ timeout },
		);
		expect(readState(statePath).started).toBe(true);
	});

	it("shows a failed handoff and restores the captured draft", async () => {
		const { session } = await launch(true);
		await session.waitForText("Ask anything...", { timeout });
		await session.type("An existing local conversation");
		await session.press("enter");
		const instruction = "retry this synthetic publish";
		await session.type(`/cloud ${instruction}`);
		await session.press("enter");
		await session.waitForText("Continue in cloud?", { timeout });
		await session.press("enter");
		await session.waitForText("Synthetic publish failure", { timeout });
		const failedScreen = await session.text();
		expect(failedScreen).not.toContain("CLOUD_SESSION_ERROR:");
		// Kitty keyboard protocol encodes Ctrl+Alt+D without dropping a modifier.
		session.writeRaw("\u001b[100;7u");
		const afterScroll = await session.text();
		expect(afterScroll).toContain("Synthetic publish failure");
		expect(afterScroll).toContain("Restore /cloud draft (Alt+E)");
		await session.press(["alt", "e"]);
		await session.waitForText(`/cloud ${instruction}`, { timeout });
		expect(await session.text()).not.toContain(
			"Create a fork of the current conversation?",
		);
	});

	it("does not overwrite a newer draft when offering to restore a failed handoff", async () => {
		const { session } = await launch(true);
		await session.waitForText("Ask anything...", { timeout });
		await session.type("/cloud earlier synthetic draft");
		await session.press("enter");
		await session.waitForText("Continue in cloud?", { timeout });
		await session.press("enter");
		await session.waitForText("Publishing the approved Git snapshot.", {
			timeout,
		});
		const newerDraft = "newer local text";
		await session.type(newerDraft);
		await session.waitForText(newerDraft, { timeout });
		await session.waitForText("Synthetic publish failure", { timeout });
		await session.press(["alt", "e"]);
		const screen = await session.text();
		expect(screen).toContain(newerDraft);
		expect(screen).not.toContain("/cloud earlier synthetic draft");
	});

	it("restores a failed handoff only after /history resumes its source session", async () => {
		const { session, statePath, stateDir } = await launch(true);
		await session.waitForText("Ask anything...", { timeout });
		await session.type("Seed the synthetic local conversation");
		await session.press("enter");
		const instruction = "resume the original synthetic task";
		const image = createSyntheticImage(stateDir);
		await session.type(`/cloud ${instruction} `);
		await pasteSyntheticImage(session, image.imagePath);
		await session.press("enter");
		await session.waitForText("Continue in cloud?", { timeout });
		await session.press("enter");
		await session.waitForText("Synthetic publish failure", { timeout });

		await session.type("/clear");
		await session.press("enter");
		await session.waitForText("What can I do for you?", { timeout });
		expect(await session.text()).not.toContain("Synthetic publish failure");
		expect(readState(statePath).activeSessionId).toBe("synthetic-session-b");
		await saveEvidence("recovery-session-b", session, statePath);

		await session.type("/history");
		await session.press("enter");
		await session.waitForText("Synthetic history session A", { timeout });
		await session.press("enter");
		await session.waitForText("Synthetic publish failure", { timeout });
		expect(readState(statePath).resumeCalls).toContain("synthetic-session-a");
		expect(readState(statePath).activeSessionId).toBe("synthetic-session-a");
		await saveEvidence("recovery-session-a", session, statePath);
		await session.press(["alt", "e"]);
		expect(await session.text()).toContain(`/cloud ${instruction}`);
		expect(await session.text()).toContain("[Image 1]");
		expect(readState(statePath).preparedSessionIds).toEqual([
			"synthetic-session-a",
		]);
		expect(readState(statePath).preparedDrafts).toEqual([
			{ instruction, images: [image.dataUrl] },
		]);
		await session.press("enter");
		await session.waitForText("Continue in cloud?", { timeout });
		expect(readState(statePath).preparedSessionIds).toEqual([
			"synthetic-session-a",
			"synthetic-session-a",
		]);
		expect(readState(statePath).preparedDrafts).toEqual([
			{ instruction, images: [image.dataUrl] },
			{ instruction, images: [image.dataUrl] },
		]);
		await session.press("escape");
	});

	it("keeps delayed completion on the session that started it", async () => {
		const { session, statePath } = await launch(false, "cline", {
			CLOUD_HANDOFF_FIXTURE_DELAY_MS: "5000",
		});
		await session.waitForText("Ask anything...", { timeout });
		await session.type("Seed the synthetic local conversation");
		await session.press("enter");
		await session.type("/cloud delayed source result");
		await session.press("enter");
		await session.waitForText("Continue in cloud?", { timeout });
		await session.press("enter");
		await session.waitForText("Publishing the approved Git snapshot.", {
			timeout,
		});
		await session.type("/clear");
		await session.press("enter");
		await session.waitForText("What can I do for you?", { timeout });
		expect(readState(statePath).completedTaskIds).toBeUndefined();
		await session.text({
			waitFor: () =>
				readState(statePath).completedTaskIds?.includes("synthetic-task-1") ===
				true,
			timeout,
		});
		expect(await session.text()).not.toContain("Cloud task ready.");
		expect(readState(statePath).activeSessionId).toBe("synthetic-session-b");
		await saveEvidence("late-completion-session-b", session, statePath);

		await session.type("/history");
		await session.press("enter");
		await session.waitForText("Synthetic history session A", { timeout });
		await session.press("enter");
		await session.waitForText(
			"Cloud task ready. You can keep working locally.",
			{
				timeout,
			},
		);
		await saveEvidence("late-completion-session-a", session, statePath);
		await session.waitForText(
			"Open cloud task (Alt+O): https://app.cline.bot/tasks/synthetic-task-1",
			{ timeout },
		);
		expect(readState(statePath).preparedSessionIds).toEqual([
			"synthetic-session-a",
		]);
	});

	it("retains the original retry target across a rejected prep and canceled confirmation", async () => {
		const { session, statePath, stateDir } = await launch(false, "cline", {
			CLOUD_HANDOFF_FIXTURE_WITH_RETRY: "1",
			CLOUD_HANDOFF_FIXTURE_REJECT_SECOND: "1",
		});
		await session.waitForText("Ask anything...", { timeout });
		await session.type("Seed the synthetic local conversation");
		await session.press("enter");
		const instruction = "send the original synthetic summary";
		const image = createSyntheticImage(stateDir);
		await session.type(`/cloud ${instruction} `);
		await pasteSyntheticImage(session, image.imagePath);
		await session.press("enter");
		await session.waitForText("Continue in cloud?", { timeout });
		await session.press("enter");
		await session.waitForText(
			"Cloud task ready. You can keep working locally.",
			{
				timeout,
			},
		);

		const rejectedDraft = "/cloud rejected replacement draft";
		await session.type(rejectedDraft);
		await session.press("enter");
		await session.waitForText("Synthetic second preparation rejected", {
			timeout,
		});
		const rejectedScreen = await session.text();
		expect(rejectedScreen).toContain(rejectedDraft);
		expect(rejectedScreen).toContain("Retry saved prompt (Alt+E)");
		await session.writeRaw("\u0015");
		await session.type("/cloud canceled replacement plan");
		await session.press("enter");
		await session.waitForText("Continue in cloud?", { timeout });
		await session.press("escape");
		const afterCancel = await session.text();
		expect(afterCancel).toContain("Retry saved prompt (Alt+E)");
		expect(afterCancel).toContain(
			"Open cloud task (Alt+O): https://app.cline.bot/tasks/synthetic-task-1",
		);
		expect(readState(statePath).retryTargets).toBeUndefined();

		await session.press(["alt", "e"]);
		await session.text({
			waitFor: () => readState(statePath).retryTargets?.length === 1,
			timeout,
		});
		expect(readState(statePath).retryTargets).toEqual([
			{
				taskId: "synthetic-task-1",
				instruction,
				images: [image.dataUrl],
			},
		]);
		await saveEvidence("retry-original-target", session, statePath);
		await session.writeRaw("\u0015");
		await session.type("/cloud approved replacement plan");
		await session.press("enter");
		await session.waitForText("Continue in cloud?", { timeout });
		await session.press("enter");
		await session.waitForText(
			"Open cloud task (Alt+O): https://app.cline.bot/tasks/synthetic-task-4",
			{ timeout },
		);
		expect(readState(statePath).preparedDrafts).toHaveLength(4);
	});
});
