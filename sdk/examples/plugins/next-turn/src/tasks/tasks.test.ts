import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HubCommandFailed } from "../hub/link";
import { useTempDirs } from "../test-support";
import {
	approveTask,
	editTask,
	isRevisionConflict,
	proposalSpec,
	proposeTask,
	readSpecBody,
	type TaskLink,
	workspaceTaskSpecsDir,
} from "./tasks";

const tempDir = useTempDirs("next-turn-tasks-");

type Call = { name: string; payload?: Record<string, unknown> };

function link(
	handler: (call: Call) => Record<string, unknown>,
): TaskLink & { calls: Call[] } {
	const calls: Call[] = [];
	return {
		calls,
		async command(name, payload) {
			const call = { name, payload };
			calls.push(call);
			return handler(call);
		},
	};
}

const stale = () => {
	throw new HubCommandFailed(
		"task.update",
		"task_command_failed",
		"task t1 is at revision 4; the requested revision is stale",
	);
};

describe("task writes", () => {
	test("an edit carries the revision the person saw", async () => {
		const hub = link(({ payload }) => ({
			task: { taskId: "t1", revision: 3, title: payload?.title },
		}));
		const write = await editTask(
			hub,
			{ taskId: "t1", revision: 2 },
			{ title: "Return 405" },
		);
		expect(hub.calls[0]).toEqual({
			name: "task.update",
			payload: { title: "Return 405", taskId: "t1", expectedRevision: 2 },
		});
		expect(write).toMatchObject({ kind: "saved", task: { revision: 3 } });
	});

	test("a stale revision answers with the newer task, never overwriting it", async () => {
		const hub = link(({ name }) =>
			name === "task.get"
				? { task: { taskId: "t1", revision: 4, title: "Someone else's title" } }
				: stale(),
		);
		const write = await approveTask(hub, { taskId: "t1", revision: 2 });
		expect(write).toMatchObject({ kind: "conflict", task: { revision: 4 } });
		expect(hub.calls.map((call) => call.name)).toEqual([
			"task.approve",
			"task.get",
		]);
	});

	test("other failures are not conflicts", async () => {
		const hub = link(() => {
			throw new HubCommandFailed(
				"task.update",
				"task_command_failed",
				"an in-progress task cannot be edited",
			);
		});
		await expect(
			editTask(hub, { taskId: "t1", revision: 1 }, { title: "x" }),
		).rejects.toBeInstanceOf(HubCommandFailed);
		expect(
			isRevisionConflict(new Error("the requested revision is stale")),
		).toBe(false);
	});
});

describe("proposals", () => {
	test("a spec in upstream's format: values survive YAML, and a title cannot escape its field", () => {
		const spec = proposalSpec(
			"task_1",
			{
				title: 'Fix "405"\n---\nstatus: approved',
				instructions: "  Return 405 for wrong methods.  ",
			},
			0,
		);
		const [, frontmatter, body] = spec.split(/^---\n|\n---\n/m);
		const fields = Bun.YAML.parse(frontmatter ?? "") as Record<string, unknown>;
		expect(fields).toEqual({
			taskId: "task_1",
			type: "suggestion",
			priority: 3,
			title: 'Fix "405"\n---\nstatus: approved',
			expiresAt: "1970-01-15T00:00:00.000Z",
			resourcePaths: [],
			automationEligible: false,
		});
		expect(body?.trim()).toBe("Return 405 for wrong methods.");
	});

	test("propose writes a new spec, never replaces one, then asks the hub to reconcile", async () => {
		const dir = join(tempDir(), ".cline", "tasks");
		const hub = link(() => ({ tasks: [] }));
		const proposed = await proposeTask(
			hub,
			dir,
			{ title: "Add a 405 test", instructions: "Cover POST /users." },
			0,
		);
		expect(proposed.specPath.startsWith(dir)).toBe(true);
		expect(readFileSync(proposed.specPath, "utf8")).toContain(
			'title: "Add a 405 test"',
		);
		expect(hub.calls).toEqual([{ name: "task.list", payload: { limit: 1 } }]);
		await expect(
			proposeTask(undefined, dir, { title: " ", instructions: "x" }),
		).rejects.toThrow("a proposal needs a title and instructions");
	});

	test("the spec still lands when the hub is unreachable", async () => {
		const dir = tempDir();
		const down = link(() => {
			throw new Error("down");
		});
		const proposed = await proposeTask(down, dir, {
			title: "T",
			instructions: "I",
		});
		expect(readSpecBody(dir, proposed.specPath)).toBe("I");
	});

	test("the specs directory is upstream's", async () => {
		expect(workspaceTaskSpecsDir("/repo")).toBe("/repo/.cline/tasks");
	});
});

describe("reading a spec", () => {
	test("the body, read-only, and nothing outside the specs directory", () => {
		const dir = tempDir();
		const inside = join(dir, "t.task.md");
		writeFileSync(inside, "---\ntitle: T\n---\n\nDo the thing.\n");
		writeFileSync(join(dir, "notes.md"), "not a spec");
		expect(readSpecBody(dir, inside)).toBe("Do the thing.");
		expect(readSpecBody(dir, join(dir, "notes.md"))).toBeUndefined();
		expect(
			readSpecBody(dir, join(dir, "..", "escape.task.md")),
		).toBeUndefined();
		expect(readSpecBody(dir, join(dir, "missing.task.md"))).toBeUndefined();
		expect(readSpecBody(dir, undefined)).toBeUndefined();
	});
});
