import { describe, expect, it } from "vitest";
import {
	resolveInteractiveShell,
	type SpawnTerminal,
	type TerminalProcess,
	TerminalSessionManager,
} from "./terminal-sessions";

type FakeProcess = TerminalProcess & {
	written: string[];
	size: { cols: number; rows: number };
	killed: boolean;
	emit(text: string): void;
	exit(code: number): void;
};

function fakeSpawner(): { spawn: SpawnTerminal; processes: FakeProcess[] } {
	const processes: FakeProcess[] = [];
	const spawn: SpawnTerminal = ({ cols, rows, onData }) => {
		let resolveExit: (code: number | null) => void = () => undefined;
		const proc: FakeProcess = {
			pid: 1000 + processes.length,
			exited: new Promise((resolve) => {
				resolveExit = resolve;
			}),
			written: [],
			size: { cols, rows },
			killed: false,
			write(data) {
				proc.written.push(data);
			},
			resize(nextCols, nextRows) {
				proc.size = { cols: nextCols, rows: nextRows };
			},
			kill() {
				proc.killed = true;
				resolveExit(null);
			},
			emit(text) {
				onData(new TextEncoder().encode(text));
			},
			exit(code) {
				resolveExit(code);
			},
		};
		processes.push(proc);
		return proc;
	};
	return { spawn, processes };
}

function createManager() {
	const events: Array<{ name: string; payload: unknown }> = [];
	const { spawn, processes } = fakeSpawner();
	const manager = new TerminalSessionManager(
		(name, payload) => events.push({ name, payload }),
		spawn,
	);
	return { manager, events, processes };
}

const decode = (base64: string) => Buffer.from(base64, "base64").toString();

describe("TerminalSessionManager", () => {
	it("groups shells by scope and streams output as base64 events", () => {
		const { manager, events, processes } = createManager();
		const first = manager.open({
			scopeId: "task-a",
			cwd: "/repo",
			cols: 100,
			rows: 30,
		});
		manager.open({ scopeId: "task-b", cwd: "/other" });

		expect(processes[0]?.size).toEqual({ cols: 100, rows: 30 });
		expect(manager.list("task-a").map((t) => t.id)).toEqual([first.id]);
		expect(manager.list("task-b")).toHaveLength(1);
		expect(manager.list("missing")).toEqual([]);

		processes[0]?.emit("hello ");
		processes[0]?.emit("world");
		expect(events.map((e) => e.name)).toEqual([
			"terminal_data",
			"terminal_data",
		]);
		expect(
			events.map((e) => decode((e.payload as { data: string }).data)).join(""),
		).toBe("hello world");
		expect(decode(manager.attach(first.id).backlog)).toBe("hello world");
	});

	it("forwards input and resizes, and rejects unknown terminals", () => {
		const { manager, processes } = createManager();
		const info = manager.open({ scopeId: "task", cwd: "/repo" });
		manager.write(info.id, "ls\n");
		manager.resize(info.id, 132, 40);
		expect(processes[0]?.written).toEqual(["ls\n"]);
		expect(processes[0]?.size).toEqual({ cols: 132, rows: 40 });
		expect(() => manager.write("nope", "x")).toThrow(/no longer open/);
	});

	it("drops exited shells and announces the exit once", async () => {
		const { manager, events, processes } = createManager();
		const info = manager.open({ scopeId: "task", cwd: "/repo" });
		processes[0]?.exit(0);
		await new Promise((resolve) => setImmediate(resolve));
		expect(manager.list("task")).toEqual([]);
		expect(events).toEqual([
			{ name: "terminal_exit", payload: { id: info.id, exitCode: 0 } },
		]);
	});

	it("kills on close without emitting an exit event", async () => {
		const { manager, events, processes } = createManager();
		const info = manager.open({ scopeId: "task", cwd: "/repo" });
		manager.close(info.id);
		await new Promise((resolve) => setImmediate(resolve));
		expect(processes[0]?.killed).toBe(true);
		expect(manager.list("task")).toEqual([]);
		expect(events).toEqual([]);
	});

	it("moves shells between scopes and disposes everything", () => {
		const { manager, processes } = createManager();
		manager.open({ scopeId: "thread-1", cwd: "/repo" });
		manager.open({ scopeId: "thread-1", cwd: "/repo" });
		expect(manager.rescope("thread-1", "session-9")).toBe(2);
		expect(manager.list("thread-1")).toEqual([]);
		expect(manager.list("session-9")).toHaveLength(2);
		manager.disposeAll();
		expect(processes.every((proc) => proc.killed)).toBe(true);
		expect(manager.list("session-9")).toEqual([]);
	});

	it("requires a scope and a working directory", () => {
		const { manager } = createManager();
		expect(() => manager.open({ scopeId: "", cwd: "/repo" })).toThrow(
			/scopeId/,
		);
		expect(() => manager.open({ scopeId: "task", cwd: "  " })).toThrow(/cwd/);
	});
});

describe("resolveInteractiveShell", () => {
	it("prefers $SHELL, as a login shell on macOS", () => {
		expect(resolveInteractiveShell({ SHELL: "/bin/zsh" }, "darwin")).toEqual({
			binary: "/bin/zsh",
			args: ["-l"],
		});
		expect(
			resolveInteractiveShell({ SHELL: "/usr/bin/fish" }, "linux"),
		).toEqual({
			binary: "/usr/bin/fish",
			args: [],
		});
		expect(resolveInteractiveShell({}, "linux")).toEqual({
			binary: "/bin/bash",
			args: [],
		});
	});

	it("uses COMSPEC or PowerShell on Windows", () => {
		expect(
			resolveInteractiveShell({ COMSPEC: "C:\\cmd.exe" }, "win32"),
		).toEqual({
			binary: "C:\\cmd.exe",
			args: [],
		});
		expect(resolveInteractiveShell({}, "win32").binary).toBe("powershell.exe");
	});
});
