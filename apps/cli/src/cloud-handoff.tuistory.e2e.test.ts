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
	started: z.boolean().optional(),
	localPrompts: z.array(z.string()).optional(),
});
type FixtureState = z.infer<typeof fixtureStateSchema>;

type FixtureProvider = "cline" | "cline-pass" | "anthropic" | "openrouter";

function launch(fail = false, provider: FixtureProvider = "cline") {
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
});
