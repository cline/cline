import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	DurablePersonalRuntimeHost,
	LocalRuntimeHost,
} from "../../../../dist/index.js";

const [phase, workspace, checkpoint, agent] = process.argv.slice(2);
let hooks;
// Exercise the real durable boundary without a provider or unrelated bootstrap.
LocalRuntimeHost.prototype.startSession = async (input) => {
	hooks = input.localRuntime.hooks;
	return { sessionId: "task" };
};
LocalRuntimeHost.prototype.readSessionCompactionState = async () => undefined;
const host = new DurablePersonalRuntimeHost({
	sessionId: "task",
	sessionService: {},
	stateStore: {
		load: async () =>
			phase === "seed"
				? { revision: 0, state: null }
				: JSON.parse(await readFile(checkpoint, "utf8")),
		save: async (revision, state) => {
			await writeFile(
				checkpoint,
				JSON.stringify({ revision: revision + 1, state }),
			);
			return revision + 1;
		},
	},
});
await host.startSession({ config: { sessionId: "task", cwd: workspace } });
if (phase === "restore") {
	console.log(
		await readFile(join(workspace, "artifacts", "receipt.txt"), "utf8"),
	);
	process.exit(0);
}
const root = {
	agentId: "root",
	runId: "run",
	messages: [],
	parentAgentId: undefined,
};
await hooks.beforeRun({ snapshot: root });
const snapshot =
	agent === "root"
		? root
		: { ...root, agentId: "child", parentAgentId: "root" };
const ctx = {
	snapshot,
	tool: { name: "apply_patch" },
	toolCall: { toolCallId: "write-receipt" },
	input: { path: "artifacts/receipt.txt" },
};
await hooks.beforeTool(ctx);
await mkdir(join(workspace, "artifacts"), { recursive: true });
await writeFile(
	join(workspace, "artifacts", "receipt.txt"),
	"acknowledged artifact",
);
await hooks.afterTool({ ...ctx, result: { output: "Created receipt.txt" } });
// No beforeModel, afterRun or dispose may flush the file before the parent kills us.
console.log("TOOL_CHECKPOINT_ACKNOWLEDGED");
setInterval(() => {}, 1000);
