import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchTerminal, type Session } from "tuistory";
import { afterEach, describe, expect, it } from "vitest";
import {
	type FixtureScenario,
	type FixtureState,
	fixtureStateSchema,
} from "./tests/fixtures/cloud-handoff-state";

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
type FixtureProvider = "cline" | "cline-pass" | "anthropic" | "openrouter";

async function runPaletteAction(session: Session, label: string) {
	await session.press(["ctrl", "p"]);
	await session.waitForText("Command Palette", { timeout });
	await session.type(label);
	await session.waitForText(label, { timeout });
	await session.press("enter");
}

function launch({
	provider = "cline",
	scenario = "success",
}: {
	provider?: FixtureProvider;
	scenario?: FixtureScenario;
} = {}) {
	const stateDir = mkdtempSync(path.join(os.tmpdir(), "cloud-handoff-tui-"));
	tempDirs.push(stateDir);
	const statePath = path.join(stateDir, "state.json");
	const releasePath = path.join(stateDir, "release");
	const localReleasePath = path.join(stateDir, "release-local");
	const removePath = path.join(stateDir, "remove-cloud-session");
	const acceptFirstPath = path.join(stateDir, "accept-first");
	const acceptSecondPath = path.join(stateDir, "accept-second");
	const lateSnapshotPath = path.join(stateDir, "late-snapshot");
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
			CLOUD_HANDOFF_FIXTURE_SCENARIO: scenario,
			CLOUD_HANDOFF_FIXTURE_RELEASE: releasePath,
			CLOUD_HANDOFF_FIXTURE_LOCAL_RELEASE: localReleasePath,
			CLOUD_HANDOFF_FIXTURE_REMOVE: removePath,
			CLOUD_HANDOFF_FIXTURE_ACCEPT_FIRST: acceptFirstPath,
			CLOUD_HANDOFF_FIXTURE_ACCEPT_SECOND: acceptSecondPath,
			CLOUD_HANDOFF_FIXTURE_LATE_SNAPSHOT: lateSnapshotPath,
		},
		cols: 120,
		rows: 40,
		waitForDataTimeout: timeout,
	});
	return sessionPromise.then((session) => {
		sessions.push(session);
		return {
			session,
			statePath,
			stateDir,
			release: () => writeFileSync(releasePath, ""),
			releaseLocal: () => writeFileSync(localReleasePath, ""),
			acceptCloudSend: (index: 1 | 2) =>
				writeFileSync(index === 1 ? acceptFirstPath : acceptSecondPath, ""),
			emitLateCloudSnapshot: () => writeFileSync(lateSnapshotPath, ""),
			removeCloudSession: () => writeFileSync(removePath, ""),
		};
	});
}

function readState(statePath: string): FixtureState {
	if (!existsSync(statePath)) return {};
	const json: unknown = JSON.parse(readFileSync(statePath, "utf8"));
	return fixtureStateSchema.parse(json);
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
		const { session } = await launch({ provider });
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
		expect(await session.text()).toContain("[Image 1]");
		expect(readState(statePath).preparations?.at(-1)?.draft).toBeUndefined();
		expect(readState(statePath).started).toBeUndefined();

		await session.press(["ctrl", "o"]);
		await session.waitForText("● Local", { timeout });
		const localScreen = await session.text();
		expect(localScreen).not.toContain("Cloud handoff:");
		expect(localScreen).not.toContain("Restore /cloud draft");
		await session.press("enter");
		await session.waitForText("Continue in cloud?", { timeout });
		expect(readState(statePath).preparations?.at(-1)?.draft).toEqual({
			instruction,
			images: [image.dataUrl],
		});
		await session.press("escape");
	});

	it("offers GitHub setup when preparation reports a disconnected integration", async () => {
		const { session, statePath } = await launch({
			scenario: "github-disconnected",
		});
		await session.waitForText("Ask anything...", { timeout });
		await session.type("/cloud continue the synthetic task");
		await session.press("enter");
		await session.waitForText("Connect GitHub", { timeout });
		expect(await session.text()).not.toContain(
			"https://app.cline.bot/settings/integrations",
		);
		expect(await session.text()).toContain(
			"/cloud continue the synthetic task",
		);
		await runPaletteAction(session, "Connect GitHub");
		await session.text({
			waitFor: () =>
				readState(statePath).openedUrls?.at(-1) ===
				"https://app.cline.bot/settings/integrations",
			timeout,
		});
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
		expect(readState(statePath).preparations?.at(-1)?.draft).toEqual({
			instruction,
			images: [image.dataUrl],
		});

		await session.waitIdle({ timeout: 5_000 });
		await session.press("enter");
		await session.waitForText("Continue in cloud?", { timeout });
		expect(readState(statePath).preparations?.at(-1)?.draft).toEqual({
			instruction,
			images: [image.dataUrl],
		});
		await session.press("escape");
	});

	it("forwards an image and keeps local chat usable while cloud work runs", async () => {
		const { session, statePath, stateDir, release } = await launch({
			scenario: "held-success",
		});
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
		expect(readState(statePath).preparations?.at(-1)?.draft).toEqual({
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
		expect(duringProvisioning).not.toContain("Cloud task started");
		expect(readState(statePath).localPrompts).toContain(localPrompt);
		release();
		await session.waitForText("Cloud task started", { timeout });
		await session.waitForText("Open cloud task (Ctrl+O)", { timeout });
		expect(await session.text()).not.toContain("https://app.cline.bot/tasks/");
		expect(readState(statePath).started).toBe(true);
	});

	it("keeps a cloud warning readable and exposes its retry action", async () => {
		const { session, statePath } = await launch({ scenario: "warning" });
		await session.waitForText("Ask anything...", { timeout });
		await session.type("/cloud send the synthetic warning task");
		await session.press("enter");
		await session.waitForText("Continue in cloud?", { timeout });
		await session.press("enter");
		await session.waitForText("Synthetic cloud send warning", { timeout });
		expect(await session.text()).toContain("Retry prompt");
		expect(await session.text()).not.toContain("Open in browser");
		await runPaletteAction(session, "Retry cloud continuation");
		await session.text({
			waitFor: () => readState(statePath).retryTargets?.length === 1,
			timeout,
		});
		expect(await session.text()).not.toContain("Open in browser");
		expect(readState(statePath).retryTargets).toEqual([
			{
				taskId: "synthetic-task-1",
				instruction: "send the synthetic warning task",
				images: [],
			},
		]);
	});

	it("restores the local conversation and reattaches to the same running cloud task", async () => {
		const { session, statePath } = await launch();
		await session.waitForText("Ask anything...", { timeout });
		const sourcePrompt = "original local conversation to restore";
		await session.type(sourcePrompt);
		await session.press("enter");
		await session.text({
			waitFor: () =>
				readState(statePath).localPrompts?.includes(sourcePrompt) === true,
			timeout,
		});
		await session.type("/cloud continue the synthetic task");
		await session.press("enter");
		await session.waitForText("Continue in cloud?", { timeout });
		await session.press("enter");
		await session.waitForText("Open cloud task (Ctrl+O)", { timeout });
		await session.press(["ctrl", "o"]);
		await session.waitForText("Synthetic attached cloud transcript", {
			timeout,
		});
		const cloudScreen = await session.text();
		expect(cloudScreen).toContain("Working in Cline Cloud");
		expect(cloudScreen).toContain("Back to local (Ctrl+O)");
		expect(cloudScreen).not.toContain("Open in browser");
		await session.text({
			waitFor: () =>
				readState(statePath).attachedSessions?.includes(
					"synthetic-cloud-session-1",
				) === true,
			timeout,
		});
		const cloudDraft = "retain draft while staying in cloud";
		await session.type(cloudDraft);
		await session.press(["ctrl", "o"]);
		const blockedReturn = await session.text();
		expect(blockedReturn).toContain(cloudDraft);
		expect(blockedReturn).toContain("Synthetic attached cloud transcript");
		expect(blockedReturn).toContain("Send or clear the current draft");
		await session.writeRaw("\u0015");

		const followUp = "continue the synthetic cloud task";
		await session.type(followUp);
		await session.press("enter");
		await session.text({
			waitFor: () => readState(statePath).cloudSends?.length === 1,
			timeout,
		});
		expect(readState(statePath).cloudSends).toEqual([
			{
				sessionId: "synthetic-cloud-session-1",
				modelId: "synthetic-cloud-model",
				prompt: followUp,
			},
		]);
		expect(readState(statePath).localPrompts).toEqual([sourcePrompt]);

		await session.press(["ctrl", "o"]);
		await session.waitForText("Cloud task started", { timeout });
		expect(await session.text()).toContain(sourcePrompt);
		expect(await session.text()).not.toContain(
			"Synthetic attached cloud transcript",
		);
		await session.type("local follow-up while cloud keeps running");
		await session.press("enter");
		await session.text({
			waitFor: () =>
				readState(statePath).localPrompts?.includes(
					"local follow-up while cloud keeps running",
				) === true,
			timeout,
		});
		expect(readState(statePath).localPrompts).toEqual([
			sourcePrompt,
			"local follow-up while cloud keeps running",
		]);
		expect(readState(statePath).abortedSessions).toBeUndefined();
		await session.press(["ctrl", "o"]);
		await session.waitForText("Synthetic attached cloud transcript", {
			timeout,
		});
		expect(readState(statePath).attachedSessions).toEqual([
			"synthetic-cloud-session-1",
			"synthetic-cloud-session-1",
		]);
		expect(readState(statePath).abortedSessions).toBeUndefined();
	});

	it("waits for both cloud prompts to be accepted and fences late results during local work", async () => {
		const {
			session,
			statePath,
			release,
			releaseLocal,
			acceptCloudSend,
			emitLateCloudSnapshot,
		} = await launch({ scenario: "held-cloud-send" });
		await session.waitForText("Ask anything...", { timeout });
		const sourcePrompt = "seed source before held cloud send";
		await session.type(sourcePrompt);
		await session.press("enter");
		await session.text({
			waitFor: () =>
				readState(statePath).localPrompts?.includes(sourcePrompt) === true,
			timeout,
		});
		await session.type("/cloud start the synthetic handoff");
		await session.press("enter");
		await session.waitForText("Continue in cloud?", { timeout });
		await session.press("enter");
		await session.waitForText("Open cloud task (Ctrl+O)", { timeout });
		await session.press(["ctrl", "o"]);
		await session.waitForText("Synthetic attached cloud transcript", {
			timeout,
		});

		await session.type("held synthetic cloud follow-up");
		await session.press("enter");
		await session.text({
			waitFor: () => readState(statePath).cloudSends?.length === 1,
			timeout,
		});
		await session.press(["ctrl", "o"]);
		const blockedReturn = await session.text();
		expect(blockedReturn).toContain("Wait for cloud to accept your");
		expect(blockedReturn).toContain("Synthetic attached cloud transcript");

		const queuedPrompt = "queue another synthetic cloud prompt";
		await session.type(queuedPrompt);
		await session.press("enter");
		acceptCloudSend(1);
		await session.text({
			waitFor: () => readState(statePath).cloudSends?.length === 2,
			timeout,
		});
		await session.press(["ctrl", "o"]);
		const blockedQueuedReturn = await session.text();
		expect(blockedQueuedReturn).toContain("Wait for cloud to accept your");
		expect(blockedQueuedReturn).toContain(
			"Synthetic attached cloud transcript",
		);
		acceptCloudSend(2);
		await session.text({
			waitFor: () => readState(statePath).acceptedCloudSends?.length === 2,
			timeout,
		});
		expect(readState(statePath).acceptedCloudSends).toEqual([
			{ prompt: "held synthetic cloud follow-up" },
			{ prompt: queuedPrompt, delivery: "queue" },
		]);

		await session.press(["ctrl", "o"]);
		await session.waitForText("Cloud task started", { timeout });
		expect(await session.text()).toContain(sourcePrompt);

		const localFollowUp = "local work while cloud send is pending";
		await session.type(localFollowUp);
		await session.press("enter");
		await session.text({
			waitFor: () =>
				readState(statePath).localPrompts?.includes(localFollowUp) === true,
			timeout,
		});
		await session.text({
			waitFor: () => readState(statePath).runningChanges?.at(-1) === true,
			timeout,
		});
		emitLateCloudSnapshot();
		await session.text({
			waitFor: () => readState(statePath).lateSnapshotsEmitted === 2,
			timeout,
		});
		release();
		await session.text({
			waitFor: () => readState(statePath).settledCloudSends?.length === 2,
			timeout,
		});
		const localScreen = await session.text();
		expect(localScreen).toContain(localFollowUp);
		expect(localScreen).not.toContain("Synthetic late cloud send failure");
		expect(localScreen).not.toContain("Late synthetic cloud snapshot");
		expect(localScreen).toContain("● Local");
		expect(readState(statePath).runningChanges?.at(-1)).toBe(true);
		expect(readState(statePath).abortedSessions).toBeUndefined();
		releaseLocal();
		await session.text({
			waitFor: () => readState(statePath).localSettled === true,
			timeout,
		});
		await session.text({
			waitFor: () => readState(statePath).runningChanges?.at(-1) === false,
			timeout,
		});
	});

	it.each([
		"history",
		"clear",
	] as const)("clears pending cloud busy state on %s", async (transition) => {
		const {
			session,
			statePath,
			acceptCloudSend,
			emitLateCloudSnapshot,
			release,
		} = await launch({ scenario: "held-cloud-send" });
		await session.waitForText("Ask anything...", { timeout });
		await session.type("Seed the synthetic source conversation");
		await session.press("enter");
		await session.text({
			waitFor: () =>
				readState(statePath).localPrompts?.includes(
					"Seed the synthetic source conversation",
				) === true,
			timeout,
		});

		await session.type("/clear");
		await session.press("enter");
		await session.waitForText("What can I do for you?", { timeout });
		const activePrompt = "Seed the active local conversation";
		await session.type(activePrompt);
		await session.press("enter");
		await session.text({
			waitFor: () =>
				readState(statePath).localPrompts?.includes(activePrompt) === true,
			timeout,
		});

		await session.type("/cloud start the synthetic handoff");
		await session.press("enter");
		await session.waitForText("Continue in cloud?", { timeout });
		await session.press("enter");
		await session.waitForText("Open cloud task (Ctrl+O)", { timeout });
		await session.press(["ctrl", "o"]);
		await session.waitForText("Synthetic attached cloud transcript", {
			timeout,
		});
		await session.type("held synthetic cloud follow-up");
		await session.press("enter");
		await session.text({
			waitFor: () => readState(statePath).cloudSends?.length === 1,
			timeout,
		});
		acceptCloudSend(1);
		await session.text({
			waitFor: () => readState(statePath).acceptedCloudSends?.length === 1,
			timeout,
		});

		const resumedSessionId =
			transition === "history" ? "synthetic-session-a" : "synthetic-session-b";
		await session.type(transition === "history" ? "/history" : "/clear");
		await session.waitForText(
			transition === "history" ? "/history" : "/clear",
			{
				timeout,
			},
		);
		await session.waitForText(
			transition === "history" ? "View session history" : "Start a new session",
			{ timeout },
		);
		expect(readState(statePath).runningChanges?.at(-1)).toBe(true);
		await session.press("enter");
		if (transition === "history") {
			await session.waitForText("Synthetic history session A", { timeout });
			await session.press("enter");
			await session.waitForText("Synthetic history conversation", { timeout });
		} else {
			await session.waitForText("What can I do for you?", { timeout });
		}
		await session.text({
			waitFor: () => readState(statePath).activeSessionId === resumedSessionId,
			timeout,
		});
		await session.text({
			waitFor: () => readState(statePath).runningChanges?.at(-1) === false,
			timeout,
		});
		if (transition === "clear") {
			await session.press(["ctrl", "o"]);
			await session.waitForText("● Local", { timeout });
		}

		await session.waitForText(
			transition === "history" ? "Ask anything..." : "What can I do for you?",
			{ timeout },
		);
		const localPrompt = `Send after the pending cloud ${transition}`;
		await session.type(localPrompt);
		await session.waitForText(localPrompt, { timeout });
		await session.press("enter");
		await session.text({
			waitFor: () =>
				readState(statePath).localPrompts?.includes(localPrompt) === true,
			timeout,
		});

		emitLateCloudSnapshot();
		await session.text({
			waitFor: () => readState(statePath).lateSnapshotsEmitted === 1,
			timeout,
		});
		release();
		await session.text({
			waitFor: () =>
				readState(statePath).settledCloudSends?.includes(
					"held synthetic cloud follow-up",
				) === true,
			timeout,
		});
		const localScreen = await session.text();
		expect(localScreen).toContain(localPrompt);
		expect(localScreen).not.toContain("Late synthetic cloud snapshot");
		expect(localScreen).toContain("● Local");
		expect(readState(statePath).activeSessionId).toBe(resumedSessionId);
		await session.press(["ctrl", "p"]);
		await session.waitForText("Command Palette", { timeout });
		await session.waitForText("Change Model", { timeout });
	});

	it("keeps the paired local return action when the attached cloud task is removed", async () => {
		const { session, statePath, removeCloudSession } = await launch({
			scenario: "removed-cloud-session",
		});
		await session.waitForText("Ask anything...", { timeout });
		const sourcePrompt = "original conversation paired with removed cloud task";
		await session.type(sourcePrompt);
		await session.press("enter");
		await session.text({
			waitFor: () =>
				readState(statePath).localPrompts?.includes(sourcePrompt) === true,
			timeout,
		});
		await session.type("/cloud create the synthetic task");
		await session.press("enter");
		await session.waitForText("Continue in cloud?", { timeout });
		await session.press("enter");
		await session.waitForText("Open cloud task (Ctrl+O)", { timeout });
		await session.press(["ctrl", "o"]);
		await session.waitForText("Synthetic attached cloud transcript", {
			timeout,
		});

		removeCloudSession();
		await session.text({
			waitFor: () =>
				readState(statePath).removedSessions?.includes(
					"synthetic-cloud-session-1",
				) === true,
			timeout,
		});
		await session.waitForText("Back to local (Ctrl+O)", { timeout });
		expect(readState(statePath).removedSessions).toEqual([
			"synthetic-cloud-session-1",
		]);
		await session.press(["ctrl", "o"]);
		await session.waitForText(sourcePrompt, { timeout });
		expect(await session.text()).toContain(sourcePrompt);
		expect(await session.text()).not.toContain(
			"Synthetic attached cloud transcript",
		);
	});

	it("keeps approval requests in cloud and offers the browser action", async () => {
		const { session, statePath } = await launch({ scenario: "approval" });
		await session.waitForText("Ask anything...", { timeout });
		await session.type("/cloud continue the synthetic task");
		await session.press("enter");
		await session.waitForText("Continue in cloud?", { timeout });
		await session.press("enter");
		await session.waitForText("Open cloud task (Ctrl+O)", { timeout });
		await session.press(["ctrl", "o"]);
		await session.waitForText("Approval needed. Open in browser to respond.", {
			timeout,
		});
		expect(await session.text()).toContain("Approval needed.");
		expect(await session.text()).toContain("Open in browser");
		expect(readState(statePath).attachedSessions).toEqual([
			"synthetic-cloud-session-1",
		]);
	});

	it("returns to local history with the cloud handoff still available", async () => {
		const { session } = await launch();
		await session.waitForText("Ask anything...", { timeout });
		await session.type("/cloud continue the synthetic task");
		await session.press("enter");
		await session.waitForText("Continue in cloud?", { timeout });
		await session.press("enter");
		await session.waitForText("Open cloud task (Ctrl+O)", { timeout });
		await session.press(["ctrl", "o"]);
		await session.waitForText("Synthetic attached cloud transcript", {
			timeout,
		});

		await session.type("/history");
		await session.press("enter");
		await session.waitForText("Synthetic history session A", { timeout });
		await session.press("enter");
		await session.waitForText("Synthetic history conversation", { timeout });
		const localScreen = await session.text();
		expect(localScreen).not.toContain("Synthetic attached cloud transcript");
		expect(localScreen).toContain("● Local");
		expect(localScreen).toContain("Cloud task started");
		expect(localScreen).toContain("Open cloud task (Ctrl+O)");
		expect(localScreen).not.toContain("Open in browser");
		expect(localScreen).not.toContain("https://app.cline.bot/tasks/");
		expect(localScreen.match(/Ctrl\+O/g)).toHaveLength(1);
		await runPaletteAction(session, "Hide cloud handoff notice");
		expect(await session.text()).not.toContain("Cloud task started");
	});

	it("offers browser only after native open fails and resets after recovery", async () => {
		const { session, statePath } = await launch({ scenario: "attach-failure" });
		await session.waitForText("Ask anything...", { timeout });
		await session.type("/cloud continue the synthetic task");
		await session.press("enter");
		await session.waitForText("Continue in cloud?", { timeout });
		await session.press("enter");
		await session.waitForText("Open cloud task (Ctrl+O)", { timeout });

		const draft = "keep this local draft";
		await session.type(draft);
		await session.press(["ctrl", "o"]);
		await session.waitForText("Send or clear the current draft", { timeout });
		const blocked = await session.text();
		expect(blocked).toContain(draft);
		expect(blocked).not.toContain("Open in browser");
		expect(readState(statePath).attachAttempts).toBeUndefined();

		await session.writeRaw("\u0015");
		await session.press(["ctrl", "o"]);
		await session.waitForText("Synthetic attach failure", { timeout });
		const failedNativeOpen = await session.text();
		expect(failedNativeOpen).toContain("Open in browser");
		expect(failedNativeOpen).not.toContain("Open cloud task (Ctrl+O)");
		expect(readState(statePath).attachAttempts).toEqual([
			"synthetic-cloud-session-1",
		]);
		await runPaletteAction(session, "Open cloud task in browser");
		await session.text({
			waitFor: () =>
				readState(statePath).openedUrls?.at(-1) ===
				"https://app.cline.bot/tasks/synthetic-task-1",
			timeout,
		});

		await session.press(["ctrl", "o"]);
		await session.waitForText("Synthetic attached cloud transcript", { timeout });
		expect(readState(statePath).attachedSessions).toEqual([
			"synthetic-cloud-session-1",
		]);
		expect(await session.text()).not.toContain("Open in browser");
		await session.press(["ctrl", "o"]);
		await session.waitForText("Ask anything...", { timeout });

		await session.type("/cloud start a new synthetic task");
		await session.press("enter");
		await session.waitForText("Continue in cloud?", { timeout });
		await session.press("enter");
		await session.waitForText("Open cloud task (Ctrl+O)", { timeout });
		expect(await session.text()).not.toContain("Open in browser");
		await session.press(["ctrl", "o"]);
		await session.waitForText("Synthetic attached cloud transcript", { timeout });
		expect(readState(statePath).localPrompts).toBeUndefined();
	});

	it.each([
		60, 120,
	])("keeps the native cloud action visible at %i columns", async (cols) => {
		const { session, statePath } = await launch();
		await session.waitForText("Ask anything...", { timeout });
		const localPrompt = "seed an established local conversation";
		await session.type(localPrompt);
		await session.press("enter");
		await session.text({
			waitFor: (screen) =>
				screen.includes(localPrompt) &&
				readState(statePath).localPrompts?.includes(localPrompt) === true,
			timeout,
		});
		await session.type("/cloud open this synthetic task");
		await session.press("enter");
		await session.waitForText("Continue in cloud?", { timeout });
		await session.press("enter");
		await session.waitForText("Open cloud task (Ctrl+O)", { timeout });
		if (cols < 120) session.resize({ cols, rows: 40 });
		const screen = await session.text();
		expect(screen).toContain("Open cloud task (Ctrl+O)");
		expect(screen).not.toContain("Open in browser");
		expect(screen).toContain("Cloud task started");
		expect(screen).not.toContain("https://app.cline.bot/tasks/");
		const footerRow = screen
			.split("\n")
			.find((line) => line.includes("Cloud task started"));
		expect(footerRow).toContain("Open cloud task (Ctrl+O)");
		expect(footerRow).not.toContain("Open in browser");
		expect(footerRow).toContain("Hide");
		await session.press(["alt", "d"]);
		await session.waitIdle({ timeout: 2_000 });
		expect(await session.text()).toContain("Cloud task started");
		await session.click("Open cloud task");
		await session.waitForText("Synthetic attached cloud transcript", { timeout });
		expect(readState(statePath).openedUrls).toBeUndefined();
		expect(await session.text()).toContain("Back to local (Ctrl+O)");
		await session.press(["ctrl", "o"]);
		await session.waitForText("Cloud task started", { timeout });
		await session.click("Hide");
		expect(await session.text()).not.toContain("Cloud task started");
		await runPaletteAction(session, "Open cloud task");
		await session.waitForText("Synthetic attached cloud transcript", { timeout });
		expect(readState(statePath).openedUrls).toBeUndefined();
		await session.press(["ctrl", "o"]);
		await session.waitForText(localPrompt, { timeout });
	});

	it("shows a failed handoff and restores the captured draft", async () => {
		const { session } = await launch({ scenario: "failure" });
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
		expect(failedScreen).toContain("Restore draft");
		expect(failedScreen).not.toContain("Hide");
		// Kitty keyboard protocol encodes Ctrl+Alt+D without dropping a modifier.
		session.writeRaw("\u001b[100;7u");
		const afterScroll = await session.text();
		expect(afterScroll).toContain("Synthetic publish failure");
		expect(afterScroll).toContain("Restore draft");
		await session.press(["alt", "e"]);
		await session.waitIdle({ timeout: 2_000 });
		expect(await session.text()).not.toContain(`/cloud ${instruction}`);
		await runPaletteAction(session, "Restore cloud handoff draft");
		await session.waitForText(`/cloud ${instruction}`, { timeout });
		expect(await session.text()).not.toContain(
			"Create a fork of the current conversation?",
		);
	});

	it("does not overwrite a newer draft when offering to restore a failed handoff", async () => {
		const { session, release } = await launch({ scenario: "held-failure" });
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
		expect(await session.text()).toContain(
			"Publishing the approved Git snapshot.",
		);
		release();
		await session.waitForText("Synthetic publish failure", { timeout });
		await runPaletteAction(session, "Restore cloud handoff draft");
		const screen = await session.text();
		expect(screen).toContain(newerDraft);
		expect(screen).not.toContain("/cloud earlier synthetic draft");
	});

	it("restores a failed handoff only after /history resumes its source session", async () => {
		const { session, statePath, stateDir } = await launch({
			scenario: "failure",
		});
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

		await session.type("/history");
		await session.press("enter");
		await session.waitForText("Synthetic history session A", { timeout });
		await session.press("enter");
		await session.waitForText("Synthetic publish failure", { timeout });
		expect(readState(statePath).resumeCalls).toContain("synthetic-session-a");
		expect(readState(statePath).activeSessionId).toBe("synthetic-session-a");
		await runPaletteAction(session, "Restore cloud handoff draft");
		expect(await session.text()).toContain(`/cloud ${instruction}`);
		expect(await session.text()).toContain("[Image 1]");
		expect(readState(statePath).preparations).toEqual([
			{
				sessionId: "synthetic-session-a",
				draft: { instruction, images: [image.dataUrl] },
			},
		]);
		await session.press("enter");
		await session.waitForText("Continue in cloud?", { timeout });
		expect(readState(statePath).preparations).toEqual([
			{
				sessionId: "synthetic-session-a",
				draft: { instruction, images: [image.dataUrl] },
			},
			{
				sessionId: "synthetic-session-a",
				draft: { instruction, images: [image.dataUrl] },
			},
		]);
		await session.press("escape");
	});

	it("keeps delayed completion on the session that started it", async () => {
		const { session, statePath, release } = await launch({
			scenario: "held-success",
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
		release();
		await session.text({
			waitFor: () =>
				readState(statePath).completedTaskIds?.includes("synthetic-task-1") ===
				true,
			timeout,
		});
		expect(await session.text()).not.toContain("Cloud task started");
		expect(readState(statePath).activeSessionId).toBe("synthetic-session-b");

		await session.type("/history");
		await session.press("enter");
		await session.waitForText("Synthetic history session A", { timeout });
		await session.press("enter");
		await session.waitForText("Cloud task started", { timeout });
		await session.waitForText("Open cloud task (Ctrl+O)", { timeout });
		expect(await session.text()).not.toContain("https://app.cline.bot/tasks/");
		expect(
			readState(statePath).preparations?.map(({ sessionId }) => sessionId),
		).toEqual(["synthetic-session-a"]);
	});

	it("retains the original retry target across a rejected prep and canceled confirmation", async () => {
		const { session, statePath, stateDir } = await launch({
			scenario: "retry",
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
		await session.waitForText("Cloud task started", { timeout });
		expect(await session.text()).toContain("Retry prompt");
		expect(await session.text()).not.toContain("Hide");

		const rejectedDraft = "/cloud rejected replacement draft";
		await session.type(rejectedDraft);
		await session.press("enter");
		await session.waitForText("Synthetic second preparation rejected", {
			timeout,
		});
		const rejectedScreen = await session.text();
		expect(rejectedScreen).toContain(rejectedDraft);
		expect(rejectedScreen).toContain("Retry prompt");
		await session.writeRaw("\u0015");
		await session.type("/cloud canceled replacement plan");
		await session.press("enter");
		await session.waitForText("Continue in cloud?", { timeout });
		await session.press("escape");
		const afterCancel = await session.text();
		expect(afterCancel).toContain("Retry prompt");
		expect(afterCancel).toContain("Open cloud task (Ctrl+O)");
		expect(afterCancel).not.toContain("Open in browser");
		expect(afterCancel).not.toContain("https://app.cline.bot/tasks/");
		expect(readState(statePath).retryTargets).toBeUndefined();

		await runPaletteAction(session, "Retry cloud continuation");
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
		await session.writeRaw("\u0015");
		await session.type("/cloud approved replacement plan");
		await session.press("enter");
		await session.waitForText("Continue in cloud?", { timeout });
		await session.press("enter");
		await session.waitForText("Cloud task started", { timeout });
		expect(await session.text()).not.toContain("Open in browser");
		await session.press(["ctrl", "o"]);
		await session.waitForText("Synthetic attached cloud transcript", { timeout });
		expect(readState(statePath).openedUrls).toBeUndefined();
		expect(readState(statePath).preparations).toHaveLength(4);
	});
});
