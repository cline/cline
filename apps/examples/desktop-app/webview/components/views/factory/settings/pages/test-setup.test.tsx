// @vitest-environment jsdom
import type { FactoryVerificationProfile } from "@cline/shared/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	FactorySettingsRefused,
	FactorySettingsUnavailable,
	type FactoryVerificationSettings,
} from "@/lib/factory-settings-client";
import {
	click,
	deadRows,
	fakeWorkflow,
	renderSettingsPage,
	type,
} from "../test-utils";
import { settingsPage } from "./test-setup";

vi.mock("@/components/ui/select", async () =>
	(await import("../test-utils")).nativeSelectModule(),
);

const hash = (c: string) => c.repeat(64);
const profile: FactoryVerificationProfile = {
	schemaVersion: 1,
	environment: {
		setup: "bun install",
		start: "bun run dev --port $PORT",
		healthcheck: "curl -sf http://localhost:$PORT",
	},
	exercise: "Open the chat view and send one message.",
	artifacts: ["test-results/**/*.png"],
	skills: ["tuistory"],
};
const other: FactoryVerificationProfile = {
	schemaVersion: 1,
	environment: { start: "npm start" },
	exercise: "Open the home page.",
	artifacts: [],
};
const base = { workspaceRoot: "/work/app", proposals: [] };
const states = {
	none: { ...base, file: "absent", status: "none" },
	proposed: {
		...base,
		file: "absent",
		status: "proposed",
		origin: "proposed",
		profile,
		hash: hash("1"),
		proposedBy: { taskId: "t-12", title: "Add retry", factoryNumber: 12 },
		proposals: [
			{
				taskId: "t-12",
				title: "Add retry",
				factoryNumber: 12,
				hash: hash("1"),
				profile,
			},
			{
				taskId: "t-15",
				title: "Show counts",
				factoryNumber: 15,
				hash: hash("2"),
				profile: other,
			},
		],
	},
	repository: {
		...base,
		file: "present",
		status: "in_use",
		origin: "repository",
		profile,
		hash: hash("3"),
		approved: { profile, hash: hash("3"), provenAt: "2026-11-10T12:00:00Z" },
		proposals: [
			{
				taskId: "t-15",
				title: "Show counts",
				factoryNumber: 15,
				hash: hash("2"),
				profile: other,
			},
		],
	},
	local: {
		...base,
		file: "absent",
		status: "in_use",
		origin: "approved_local",
		profile,
		hash: hash("4"),
		approved: { profile, hash: hash("4") },
	},
	changed: {
		...base,
		file: "present",
		status: "changed",
		origin: "proposed",
		profile: {
			...profile,
			environment: {
				...profile.environment,
				setup: "bun install && bun run seed",
			},
		},
		hash: hash("5"),
		approved: { profile, hash: hash("6") },
	},
	invalid: {
		...base,
		file: "invalid",
		status: "invalid",
		reason: "environment: Provide a setup or start command",
		approved: { profile, hash: hash("7") },
	},
} satisfies Record<string, FactoryVerificationSettings>;

let unmount: (() => Promise<void>) | undefined;
afterEach(async () => {
	await unmount?.();
	unmount = undefined;
});

async function render(
	settings: FactoryVerificationSettings,
	options: Parameters<typeof renderSettingsPage>[1] = {},
) {
	const page = await renderSettingsPage(settingsPage, {
		...options,
		client: {
			getVerification: async () => settings,
			setVerification: async () => states.local,
			...options.client,
		},
	});
	unmount = page.unmount;
	return page;
}

const actions = (page: { row: (id: string) => HTMLElement | null }) =>
	[...(page.row("testSetup")?.querySelectorAll("button") ?? [])].map(
		(button) => button.textContent,
	);

describe("Test setup page", () => {
	it("offers each state's actions, and no dead rows", async () => {
		const expected: [FactoryVerificationSettings, string[]][] = [
			[states.none, ["Set one up", "Ask Factory"]],
			[states.proposed, ["F12", "Edit", "Approve"]],
			[states.repository, ["Stop using"]],
			[states.local, ["Edit", "Stop using"]],
			[states.changed, ["Stop using", "Approve new version"]],
			[states.invalid, ["Stop using", "Fix with Ask Factory"]],
		];
		for (const [settings, buttons] of expected) {
			const page = await render(settings);
			expect(actions(page)).toEqual(buttons);
			expect(deadRows(page.container)).toEqual([]);
			await page.unmount();
			unmount = undefined;
		}
	});

	it("shows the whole setup it asks the person to approve", async () => {
		const page = await render(states.proposed);
		const text = page.text();
		expect(text).toContain("Factory proposed a test setup for app.");
		expect(text).toContain("Proposed while scoping F12 “Add retry”.");
		expect(text).toContain("Needs approval");
		for (const value of [
			"bun install",
			"bun run dev --port $PORT",
			"curl -sf http://localhost:$PORT",
			"answers, within 120 seconds",
			"Open the chat view and send one message.",
			"test-results/**/*.png",
			"tuistory",
		])
			expect(text).toContain(value);
		expect(text).toContain(
			"The tester runs these commands in each card's worktree on this computer, as you, with access to your files.",
		);
	});

	it("approves by the shown hash and stops using by the approved hash", async () => {
		const page = await render(states.proposed);
		await click(page.buttons("Approve")[0]);
		expect(page.shell.client.setVerification).toHaveBeenCalledWith({
			workspaceRoot: "/work/app",
			decision: "approve",
			expectedHash: hash("1"),
		});
		expect(page.shell.saved).toHaveBeenCalled();
		expect(page.shell.projectsSummary.reload).toHaveBeenCalled();
		// The reply is the new state: in use, approved on this computer.
		expect(page.text()).toContain("approved on this computer");
		await click(page.buttons("Stop using")[0]);
		expect(page.shell.client.setVerification).toHaveBeenLastCalledWith({
			workspaceRoot: "/work/app",
			decision: "remove",
			expectedHash: hash("4"),
		});
	});

	it("on a stale hash says so and reloads on request", async () => {
		const page = await render(states.changed, {
			client: {
				setVerification: async () => {
					throw new FactorySettingsRefused(
						"factory_verification_stale",
						"The test setup changed since it was shown. Review it again.",
						hash("8"),
					);
				},
			},
		});
		await click(page.buttons("Approve new version")[0]);
		expect(page.shell.client.setVerification).toHaveBeenCalledWith({
			workspaceRoot: "/work/app",
			decision: "approve",
			expectedHash: hash("5"),
		});
		expect(page.row("testSetup")?.textContent).toContain(
			"The test setup changed. Review it again.",
		);
		expect(page.shell.saved).not.toHaveBeenCalled();
		await click(page.buttons("Reload")[0]);
		expect(page.shell.client.getVerification).toHaveBeenCalledTimes(2);
	});

	it("words a changed file per the contract and marks what changed", async () => {
		const page = await render(states.changed);
		const text = page.text();
		expect(text).toContain(
			"The test setup file changed since you approved it.",
		);
		expect(text).toContain(
			"Nothing runs until you approve the new version or stop using the approval.",
		);
		expect(text).not.toMatch(/keeps using|Keep approved/i);
		const install = page.container.querySelector('[data-field="install"]');
		expect(install?.getAttribute("data-changed")).toBe("true");
		expect(
			page.container
				.querySelector('[data-field="start"]')
				?.getAttribute("data-changed"),
		).toBeNull();
		expect(text).toContain("Was: bun install");
		await click(page.buttons("Stop using")[0]);
		expect(page.shell.client.setVerification).toHaveBeenCalledWith({
			workspaceRoot: "/work/app",
			decision: "remove",
			expectedHash: hash("6"),
		});
	});

	it("edits through a confirmation that lists the commands, then saves a local setup", async () => {
		const page = await render(states.local);
		await click(page.buttons("Edit")[0]);
		const field = (label: string) =>
			[...page.container.querySelectorAll("label")]
				.find((element) => element.querySelector("span")?.textContent === label)
				?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
					"input, textarea",
				) ?? null;
		expect(field("Install")?.value).toBe("bun install");
		await type(field("Install"), "bun install --frozen-lockfile");
		await click(page.buttons("Review and save…")[0]);
		const confirm = document.querySelector("[data-test-setup-confirm]");
		expect(confirm?.textContent).toContain(
			"Install: bun install --frozen-lockfile",
		);
		expect(confirm?.textContent).toContain("Start: bun run dev --port $PORT");
		// Nothing is saved before the person confirms.
		expect(page.shell.client.setVerification).not.toHaveBeenCalled();
		await click(page.buttons("Approve and save")[0]);
		expect(page.shell.client.setVerification).toHaveBeenCalledWith({
			workspaceRoot: "/work/app",
			decision: "approve",
			expectedHash: hash("4"),
			profile: {
				...profile,
				environment: {
					...profile.environment,
					setup: "bun install --frozen-lockfile",
				},
			},
		});
		expect(
			page.container.querySelector('[data-setting="testSetupEditor"]'),
		).toBeNull();
	});

	it("validates the form before confirming, and shows a refusal in the confirmation", async () => {
		const page = await render(states.none, {
			client: {
				setVerification: async () => {
					throw new FactorySettingsRefused(
						"factory_verification_invalid",
						"Commands must not use sudo.",
					);
				},
			},
		});
		await click(page.buttons("Set one up")[0]);
		await click(page.buttons("Review and save…")[0]);
		expect(page.row("testSetupEditor")?.textContent).toContain(
			"Install or Start is required.",
		);
		expect(document.querySelector("[data-test-setup-confirm]")).toBeNull();
		const inputs = page.container.querySelectorAll<HTMLInputElement>(
			'[data-setting="testSetupEditor"] input',
		);
		await type(inputs[0] ?? null, "sudo make install");
		await type(
			page.container.querySelector<HTMLTextAreaElement>(
				'[data-setting="testSetupEditor"] textarea',
			),
			"Open it.",
		);
		await click(page.buttons("Review and save…")[0]);
		await click(page.buttons("Approve and save")[0]);
		expect(page.shell.client.setVerification).toHaveBeenCalledWith({
			workspaceRoot: "/work/app",
			decision: "approve",
			profile: {
				schemaVersion: 1,
				environment: { setup: "sudo make install" },
				exercise: "Open it.",
				artifacts: [],
			},
		});
		expect(document.body.textContent).toContain("Commands must not use sudo.");
	});

	it("lists other cards' proposals: approvable without a file, shown only with one", async () => {
		const page = await render(states.proposed);
		// The proposal shown above is not listed twice.
		expect(page.row("proposal-t-12")).toBeNull();
		const row = page.row("proposal-t-15");
		expect(row?.textContent).toContain("Proposed by F15");
		expect(row?.textContent).toContain("Show counts");
		expect(row?.textContent).toContain("npm start");
		await click(row?.querySelector("[data-card-link]"));
		expect(page.shell.openCard).toHaveBeenCalledWith("t-15");
		await click(
			[...(row?.querySelectorAll("button") ?? [])].find(
				(button) => button.textContent === "Approve",
			),
		);
		expect(page.shell.client.setVerification).toHaveBeenCalledWith({
			workspaceRoot: "/work/app",
			decision: "approve",
			expectedHash: hash("2"),
		});
		await page.unmount();
		const withFile = await render(states.repository);
		const shown = withFile.row("proposal-t-15");
		expect(shown?.textContent).not.toContain("Approve");
		expect(shown?.querySelector("[aria-expanded]")).not.toBeNull();
		expect(deadRows(withFile.container)).toEqual([]);
	});

	it("asks Factory from the empty and invalid states", async () => {
		const empty = await render(states.none);
		expect(empty.text()).toContain("No test setup for app.");
		expect(empty.text()).toContain(
			"Factory proposes one when a plan needs it.",
		);
		await click(empty.buttons("Ask Factory")[0]);
		expect(empty.shell.askFactory).toHaveBeenCalledWith(
			"Set up a test setup for app that ",
		);
		await empty.unmount();
		const invalid = await render(states.invalid);
		expect(invalid.text()).toContain(
			"environment: Provide a setup or start command",
		);
		await click(invalid.buttons("Fix with Ask Factory")[0]);
		expect(invalid.shell.askFactory).toHaveBeenCalledWith(
			"Fix .cline/factory/verification.json in app. It can't be read: environment: Provide a setup or start command",
		);
	});

	it("notes a workflow-level setup and links the tester to Roles & models", async () => {
		const page = await render(states.repository, {
			shell: {
				workflow: fakeWorkflow({
					agents: {
						verifier: {
							modelSelection: {
								providerId: "anthropic",
								modelId: "claude-haiku-5",
							},
							environment: { start: "npm start" },
						},
					},
				} as never),
			},
		});
		expect(page.text()).toContain(
			"The default workflow has its own test setup, which is used instead.",
		);
		expect(page.row("testerModel")?.textContent).toContain("claude-haiku-5.");
		await click(page.row("testerModel")?.querySelector("button"));
		expect(page.shell.open).toHaveBeenCalledWith({
			page: "roles",
			role: "verifier",
		});
	});

	it("degrades to one line when the command is unavailable", async () => {
		const page = await render(states.none, {
			client: {
				getVerification: async () => {
					throw new FactorySettingsUnavailable(
						"factory_get_verification",
						"hub",
					);
				},
			},
		});
		expect(
			page.container.querySelector("[data-settings-unavailable]")?.textContent,
		).toBe("Test setup: update Cline to use it.");
		expect(page.buttons(/^(Approve|Stop using|Edit|Set one up)$/)).toHaveLength(
			0,
		);
		expect(deadRows(page.container)).toEqual([]);
	});

	it("reads the selected project again when it changes", async () => {
		const page = await render(states.none, {
			shell: { projects: ["/work/app", "/work/api"], project: "/work/app" },
		});
		await page.rerender({ ...page.shell, project: "/work/api" });
		expect(page.shell.client.getVerification).toHaveBeenLastCalledWith(
			"/work/api",
		);
	});
});
