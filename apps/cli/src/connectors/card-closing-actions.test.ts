import { describe, expect, it, vi } from "vitest";

import {
	buildClosingActionId,
	buildClosingButtons,
	buildClosingCommandArgs,
	buildConfirmButtons,
	describeClosingOutcome,
	handleClosingTap,
	parseClosingActionId,
	readClosingConfirm,
	resolveClosingTap,
	runClosingAction,
} from "./card-closing-actions";

const card = { taskId: "52609", projectPath: "/Users/me/work-os" };

describe("closing action ids", () => {
	it("round-trips every action, and stays well under Telegram's 64 bytes", () => {
		for (const action of [
			"integrate",
			"push",
			"done",
			"done!",
			"cancel",
		] as const) {
			const id = buildClosingActionId("52609", action);
			expect(parseClosingActionId(id)).toEqual({ taskId: "52609", action });
			expect(Buffer.byteLength(id)).toBeLessThan(64);
		}
	});

	it("ignores question buttons and anything malformed", () => {
		expect(parseClosingActionId("kbq:52609:1")).toBeUndefined();
		expect(parseClosingActionId("kba:52609:rm")).toBeUndefined();
		expect(parseClosingActionId("kba::done")).toBeUndefined();
		expect(parseClosingActionId(undefined)).toBeUndefined();
	});
});

describe("buildClosingButtons", () => {
	it("keeps the order and labels Kanban sent", () => {
		expect(
			buildClosingButtons("52609", [
				{ id: "integrate", label: "Integrar na main" },
				{
					id: "done",
					label: "Concluir",
					confirm: "1 commit não integrado será descartado.",
				},
			]),
		).toEqual([
			{ label: "Integrar na main", actionId: "kba:52609:integrate" },
			{ label: "Concluir", actionId: "kba:52609:done" },
		]);
	});

	it("asks with a confirmed Concluir and a Cancelar", () => {
		expect(buildConfirmButtons("52609")).toEqual([
			{ label: "Concluir mesmo assim", actionId: "kba:52609:done!" },
			{ label: "Cancelar", actionId: "kba:52609:cancel" },
		]);
	});
});

describe("buildClosingCommandArgs", () => {
	it("maps each action to its kanban command", () => {
		expect(buildClosingCommandArgs(card, "integrate")).toEqual([
			"task",
			"integrate",
			"--task-id",
			"52609",
			"--project-path",
			"/Users/me/work-os",
		]);
		expect(buildClosingCommandArgs(card, "push")[1]).toBe("push");
		expect(buildClosingCommandArgs(card, "done")[1]).toBe("done");
	});
});

describe("runClosingAction", () => {
	it("runs the command and reports the push output", async () => {
		const run = vi.fn(async (_args: string[]) => ({
			stdout: JSON.stringify({ ok: true, output: "main -> main" }),
		}));
		const result = await runClosingAction(card, "push", { run });
		expect(run).toHaveBeenCalledWith(buildClosingCommandArgs(card, "push"));
		expect(result).toEqual({ ok: true, message: "main -> main" });
	});

	// Shaped like the real CLI's failure: the reason in stdout JSON, stderr empty.
	it("explains a refusal in words, naming what was refused", async () => {
		const run = vi.fn(async (_args: string[]): Promise<{ stdout: string }> => {
			throw Object.assign(new Error("Command failed: kanban task push"), {
				stderr: "",
				stdout: JSON.stringify({
					ok: false,
					error:
						"Task command failed at http://127.0.0.1:3484: The repository is on other, not main.",
				}),
			});
		});
		const result = await runClosingAction(card, "push", { run });
		expect(result).toEqual({
			ok: false,
			message: "Kanban refused the push: The repository is on other, not main.",
		});
	});
});

describe("describeClosingOutcome", () => {
	it("says what happened, in the message that held the buttons", () => {
		expect(describeClosingOutcome("integrate", "Integrar na main")).toBe(
			"⏳ Integrar na main…",
		);
		expect(describeClosingOutcome("push", "Push")).toBe("✅ Push feito");
		expect(describeClosingOutcome("done", "Concluir")).toBe("🟢 Concluído");
	});
});

describe("resolveClosingTap", () => {
	const remembered = {
		taskId: "52609",
		projectPath: "/w",
		actions: [
			{ id: "integrate" as const, label: "Integrar na main" },
			{
				id: "done" as const,
				label: "Concluir",
				confirm: "1 commit não integrado será descartado.",
			},
		],
	};

	// After a restart the message is still known from disk, so the action still runs.
	it("runs integrate from the remembered card", () => {
		expect(
			resolveClosingTap(remembered, { taskId: "52609", action: "integrate" }),
		).toEqual({ kind: "run", action: "integrate", label: "Integrar na main" });
	});

	it("runs the confirmed Concluir", () => {
		expect(
			resolveClosingTap(remembered, { taskId: "52609", action: "done!" }),
		).toEqual({ kind: "run", action: "done", label: "Concluir" });
	});

	// Whether to ask first is decided from git at the moment of the tap (handleClosingTap), not
	// from the confirm the notification carried.
	it("names Concluir's command without deciding whether to ask", () => {
		expect(
			resolveClosingTap(remembered, { taskId: "52609", action: "done" }),
		).toEqual({ kind: "run", action: "done", label: "Concluir" });
	});

	it("refuses a button whose card it cannot place", () => {
		expect(
			resolveClosingTap(undefined, { taskId: "52609", action: "push" }),
		).toEqual({ kind: "unknown" });
		expect(
			resolveClosingTap(remembered, { taskId: "other", action: "push" }),
		).toEqual({ kind: "unknown" });
	});

	it("cancels", () => {
		expect(
			resolveClosingTap(remembered, { taskId: "52609", action: "cancel" }),
		).toEqual({ kind: "cancel" });
	});
});

describe("handleClosingTap", () => {
	const remembered = {
		taskId: "52609",
		projectPath: "/w",
		text: "Ready for review\n\nAjuste os links — work-os",
		actions: [
			{ id: "integrate" as const, label: "Integrar na main" },
			{ id: "done" as const, label: "Concluir" },
		],
	};

	type Effects = Parameters<typeof handleClosingTap>[0]["effects"];

	function effects(
		overrides: {
			run?: Effects["run"];
			readConfirm?: Effects["readConfirm"];
		} = {},
	) {
		return {
			edit: vi.fn<Effects["edit"]>(async () => true),
			post: vi.fn<Effects["post"]>(async () => undefined),
			run: vi.fn<Effects["run"]>(
				overrides.run ?? (async () => ({ ok: true, message: "" })),
			),
			readConfirm: vi.fn<Effects["readConfirm"]>(
				overrides.readConfirm ?? (async () => ({ ok: true })),
			),
		};
	}

	// The keyboard comes off before the command runs: a push takes seconds, Telegram shows a
	// spinner, and a second tap would run it twice.
	it("removes the buttons before running, then says what happened", async () => {
		const fx = effects();
		await handleClosingTap({
			card: remembered,
			tap: { taskId: "52609", action: "integrate" },
			messageId: "m1",
			inFlight: new Set(),
			effects: fx,
		});
		expect(fx.edit.mock.calls[0]).toEqual([
			`${remembered.text}\n\n⏳ Integrar na main…`,
		]);
		expect(fx.edit.mock.invocationCallOrder[0]).toBeLessThan(
			fx.run.mock.invocationCallOrder[0] ?? 0,
		);
		expect(fx.run).toHaveBeenCalledWith("integrate");
	});

	it("ignores a second tap while the first is still running", async () => {
		const fx = effects();
		const inFlight = new Set(["m1"]);
		await handleClosingTap({
			card: remembered,
			tap: { taskId: "52609", action: "push" },
			messageId: "m1",
			inFlight,
			effects: fx,
		});
		expect(fx.run).not.toHaveBeenCalled();
		expect(fx.edit).not.toHaveBeenCalled();
	});

	it("puts the buttons back and explains when the command is refused", async () => {
		const fx = effects({
			run: vi.fn(async () => ({
				ok: false,
				message: "Kanban refused the push: rejected",
			})),
		});
		const inFlight = new Set<string>();
		await handleClosingTap({
			card: remembered,
			tap: { taskId: "52609", action: "push" },
			messageId: "m1",
			inFlight,
			effects: fx,
		});
		expect(fx.edit.mock.calls.at(-1)).toEqual([
			remembered.text,
			buildClosingButtons("52609", remembered.actions),
		]);
		expect(fx.post).toHaveBeenCalledWith("Kanban refused the push: rejected");
		expect(inFlight.size).toBe(0);
	});

	it("posts what the push printed", async () => {
		const fx = effects({
			run: vi.fn(async () => ({ ok: true, message: "main -> main" })),
		});
		await handleClosingTap({
			card: remembered,
			tap: { taskId: "52609", action: "push" },
			messageId: "m1",
			inFlight: new Set(),
			effects: fx,
		});
		expect(fx.edit.mock.calls.at(-1)).toEqual([
			`${remembered.text}\n\n✅ Push feito`,
		]);
		expect(fx.post).toHaveBeenCalledWith("main -> main");
	});

	// The notification that offered this Concluir may be older than the agent's latest commits:
	// what Concluir would discard is asked of git now, not read from the button.
	it("asks before Concluir when git says work would be lost now", async () => {
		const fx = effects({
			readConfirm: vi.fn(async () => ({
				ok: true as const,
				confirm: "1 commit não integrado será descartado.",
			})),
		});
		await handleClosingTap({
			card: remembered,
			tap: { taskId: "52609", action: "done" },
			messageId: "m1",
			inFlight: new Set(),
			effects: fx,
		});
		expect(fx.run).not.toHaveBeenCalled();
		expect(fx.edit).toHaveBeenCalledWith(
			`${remembered.text}\n\n⚠️ 1 commit não integrado será descartado.`,
			buildConfirmButtons("52609"),
		);
	});

	it("asks before Concluir when it cannot find out", async () => {
		const fx = effects({
			readConfirm: vi.fn(async () => ({ ok: false as const })),
		});
		await handleClosingTap({
			card: remembered,
			tap: { taskId: "52609", action: "done" },
			messageId: "m1",
			inFlight: new Set(),
			effects: fx,
		});
		expect(fx.run).not.toHaveBeenCalled();
		expect(fx.edit.mock.calls[0]?.[0]).toContain("Não consegui verificar");
	});

	it("runs Concluir at once when nothing would be lost", async () => {
		const fx = effects();
		await handleClosingTap({
			card: remembered,
			tap: { taskId: "52609", action: "done" },
			messageId: "m1",
			inFlight: new Set(),
			effects: fx,
		});
		expect(fx.run).toHaveBeenCalledWith("done");
		expect(fx.edit.mock.calls.at(-1)?.[0]).toContain("🟢 Concluído");
	});

	it("runs the confirmed Concluir without asking again", async () => {
		const fx = effects();
		await handleClosingTap({
			card: remembered,
			tap: { taskId: "52609", action: "done!" },
			messageId: "m1",
			inFlight: new Set(),
			effects: fx,
		});
		expect(fx.readConfirm).not.toHaveBeenCalled();
		expect(fx.run).toHaveBeenCalledWith("done");
	});

	it("goes back to the offer on Cancelar", async () => {
		const fx = effects();
		await handleClosingTap({
			card: remembered,
			tap: { taskId: "52609", action: "cancel" },
			messageId: "m1",
			inFlight: new Set(),
			effects: fx,
		});
		expect(fx.edit).toHaveBeenCalledWith(
			remembered.text,
			buildClosingButtons("52609", remembered.actions),
		);
	});

	it("says so when it cannot place the button", async () => {
		const fx = effects();
		await handleClosingTap({
			card: undefined,
			tap: { taskId: "52609", action: "push" },
			messageId: "m1",
			inFlight: new Set(),
			effects: fx,
		});
		expect(fx.post).toHaveBeenCalledWith(
			"I no longer know which card that button belongs to.",
		);
		expect(fx.run).not.toHaveBeenCalled();
	});
});

describe("readClosingConfirm", () => {
	it("asks Kanban what Concluir would discard now", async () => {
		const run = vi.fn(async (_args: string[]) => ({
			stdout: JSON.stringify({
				ok: true,
				actions: [
					{ id: "integrate", label: "Integrar na main" },
					{
						id: "done",
						label: "Concluir",
						confirm: "2 commits não integrados serão descartados.",
					},
				],
			}),
		}));
		expect(await readClosingConfirm(card, { run })).toEqual({
			ok: true,
			confirm: "2 commits não integrados serão descartados.",
		});
		expect(run).toHaveBeenCalledWith([
			"task",
			"closing-state",
			"--task-id",
			"52609",
			"--project-path",
			"/Users/me/work-os",
		]);
	});

	it("says nothing would be lost when Concluir carries no confirm", async () => {
		const run = vi.fn(async (_args: string[]) => ({
			stdout: JSON.stringify({
				ok: true,
				actions: [{ id: "done", label: "Concluir" }],
			}),
		}));
		expect(await readClosingConfirm(card, { run })).toEqual({ ok: true });
	});

	it("reports that it could not find out", async () => {
		const run = vi.fn(async (_args: string[]): Promise<{ stdout: string }> => {
			throw new Error("Command failed");
		});
		expect(await readClosingConfirm(card, { run })).toEqual({ ok: false });
		const garbled = vi.fn(async (_args: string[]) => ({ stdout: "not json" }));
		expect(await readClosingConfirm(card, { run: garbled })).toEqual({
			ok: false,
		});
	});
});
