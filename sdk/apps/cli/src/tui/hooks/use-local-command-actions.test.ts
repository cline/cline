import { describe, expect, it, vi } from "vitest";
import { formatCompactionStatus } from "../utils/compaction-status";
import {
	type LocalSlashCommandActionInput,
	runLocalSlashCommandAction,
} from "./local-command-actions";

function makeActions(
	overrides: Partial<Omit<LocalSlashCommandActionInput, "name">> = {},
): Omit<LocalSlashCommandActionInput, "name"> {
	return {
		openAccount: vi.fn(),
		openConfig: vi.fn(),
		openMcpManager: vi.fn(async () => false),
		openModelSelector: vi.fn(),
		runCompact: vi.fn(),
		runFork: vi.fn(),
		runUndo: vi.fn(async () => {}),
		clearConversation: vi.fn(async () => {}),
		openHelp: vi.fn(),
		openHistory: vi.fn(),
		exitCline: vi.fn(),
		...overrides,
	};
}

describe("runLocalSlashCommandAction", () => {
	it("waits for clear to reset the runtime session", async () => {
		let resolveClear: (() => void) | undefined;
		const clearConversation = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveClear = resolve;
				}),
		);
		const actions = makeActions({ clearConversation });

		const handled = runLocalSlashCommandAction({
			name: "clear",
			...actions,
		});
		const handledPromise = Promise.resolve(handled);
		let settled = false;
		void handledPromise.then(() => {
			settled = true;
		});

		await Promise.resolve();

		expect(clearConversation).toHaveBeenCalledOnce();
		expect(settled).toBe(false);

		resolveClear?.();

		expect(await handledPromise).toBe(true);
		expect(settled).toBe(true);
	});

	it("waits for undo to finish restoring", async () => {
		let resolveUndo: (() => void) | undefined;
		const runUndo = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveUndo = resolve;
				}),
		);
		const actions = makeActions({ runUndo });

		const handled = runLocalSlashCommandAction({
			name: "undo",
			...actions,
		});
		const handledPromise = Promise.resolve(handled);
		let settled = false;
		void handledPromise.then(() => {
			settled = true;
		});

		await Promise.resolve();

		expect(runUndo).toHaveBeenCalledOnce();
		expect(settled).toBe(false);

		resolveUndo?.();

		expect(await handledPromise).toBe(true);
		expect(settled).toBe(true);
	});

	it("exits Cline with quit", () => {
		vi.useFakeTimers();
		const exitCline = vi.fn();
		const actions = makeActions({ exitCline });

		try {
			const handled = runLocalSlashCommandAction({
				name: "quit",
				...actions,
			});

			expect(handled).toBe(true);
			expect(exitCline).not.toHaveBeenCalled();

			vi.runAllTimers();

			expect(exitCline).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("formatCompactionStatus", () => {
	it("reports when core did not return a compaction result", () => {
		expect(
			formatCompactionStatus({
				messagesBefore: 300,
				messagesAfter: 300,
				compacted: false,
			}),
		).toBe("No compaction needed.");
	});

	it("reports same-count compaction without implying no-op", () => {
		expect(
			formatCompactionStatus({
				messagesBefore: 300,
				messagesAfter: 300,
				compacted: true,
			}),
		).toBe("Compacted context; message count stayed at 300.");
	});

	it("reports empty sessions separately", () => {
		expect(
			formatCompactionStatus({
				messagesBefore: 0,
				messagesAfter: 0,
				compacted: false,
			}),
		).toBe("No messages to compact.");
	});
});
