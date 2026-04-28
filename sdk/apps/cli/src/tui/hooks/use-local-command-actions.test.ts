import { describe, expect, it, vi } from "vitest";
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
