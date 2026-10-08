import { homedir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeTerminalsForOwner, handleTerminalCommand } from "./terminals";
import type { SidecarWebSocketClient } from "./types";

type SpawnOptions = {
	cwd: string;
	env: Record<string, string>;
	terminal: { data: (terminal: unknown, data: Uint8Array) => void };
};

function fakeSpawn() {
	const spawned: Array<{
		cmd: string[];
		options: SpawnOptions;
		terminal: {
			write: ReturnType<typeof vi.fn>;
			resize: ReturnType<typeof vi.fn>;
			close: ReturnType<typeof vi.fn>;
		};
		kill: ReturnType<typeof vi.fn>;
		exit: (code: number) => void;
	}> = [];
	const spawn = vi.fn((cmd: string[], options: SpawnOptions) => {
		let exit!: (code: number) => void;
		const exited = new Promise<number>((resolve) => {
			exit = resolve;
		});
		const proc = {
			terminal: { write: vi.fn(), resize: vi.fn(), close: vi.fn() },
			kill: vi.fn(() => exit(129)),
			exited,
		};
		spawned.push({ cmd, options, ...proc, exit });
		return proc;
	});
	return { spawn, spawned };
}

function client(trusted = true) {
	const messages: Array<{ name: string; payload: unknown }> = [];
	const ws: SidecarWebSocketClient = {
		data: { canApproveTools: trusted },
		send: (raw) => messages.push(JSON.parse(raw).event),
	};
	return { ws, messages };
}

describe("terminals", () => {
	let fake: ReturnType<typeof fakeSpawn>;

	beforeEach(() => {
		fake = fakeSpawn();
		vi.stubGlobal("Bun", { spawn: fake.spawn });
		vi.stubEnv("CLINE_SIDECAR_APPROVAL_TOKEN", "secret");
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});

	it("rejects connections without the approval token", () => {
		expect(() =>
			handleTerminalCommand("terminal_create", {}, client(false).ws),
		).toThrow("trusted desktop connection");
		expect(fake.spawn).not.toHaveBeenCalled();
	});

	it("starts a login shell, streams output, and reports exit", async () => {
		const { ws, messages } = client();
		const { id, cwd } = handleTerminalCommand(
			"terminal_create",
			{ cwd: "/definitely/missing", cols: 100, rows: 30 },
			ws,
		) as { id: string; cwd: string };
		const [proc] = fake.spawned;

		expect(cwd).toBe(homedir());
		expect(proc.options.cwd).toBe(homedir());
		expect(proc.cmd[1]).toBe("-l");
		expect(proc.options.env.CLINE_SIDECAR_APPROVAL_TOKEN).toBeUndefined();
		expect(proc.options.env.TERM).toBe("xterm-256color");

		proc.options.terminal.data(null, new TextEncoder().encode("hi "));
		proc.options.terminal.data(null, new TextEncoder().encode("there"));
		await vi.waitFor(() =>
			expect(messages).toContainEqual({
				name: "terminal_output",
				payload: { id, data: "hi there" },
			}),
		);

		proc.exit(0);
		await vi.waitFor(() =>
			expect(messages).toContainEqual({
				name: "terminal_exit",
				payload: { id, exitCode: 0 },
			}),
		);
		expect(proc.terminal.close).toHaveBeenCalled();
	});

	it("only lets the owning connection drive a terminal", () => {
		const owner = client();
		const other = client();
		const { id } = handleTerminalCommand("terminal_create", {}, owner.ws) as {
			id: string;
		};
		const [proc] = fake.spawned;

		handleTerminalCommand("terminal_write", { id, data: "ls\r" }, other.ws);
		handleTerminalCommand("terminal_close", { id }, other.ws);
		expect(proc.terminal.write).not.toHaveBeenCalled();
		expect(proc.kill).not.toHaveBeenCalled();

		handleTerminalCommand("terminal_write", { id, data: "ls\r" }, owner.ws);
		handleTerminalCommand(
			"terminal_resize",
			{ id, cols: 120, rows: 40 },
			owner.ws,
		);
		expect(proc.terminal.write).toHaveBeenCalledWith("ls\r");
		expect(proc.terminal.resize).toHaveBeenCalledWith(120, 40);
	});

	it("kills a connection's shells when it goes away", () => {
		const owner = client();
		handleTerminalCommand("terminal_create", {}, owner.ws);
		handleTerminalCommand("terminal_create", {}, owner.ws);

		closeTerminalsForOwner(owner.ws);
		expect(
			fake.spawned.every((proc) => proc.kill.mock.calls.length === 1),
		).toBe(true);
	});
});
