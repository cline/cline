// Test fixture: a real out-of-process worker entry with a scripted echo
// workload. Spawned by workers.test.ts through the process driver's
// explicit development-only unsandboxed mode (requires built dist/).
import { runWorkerEntry } from "../../../dist/index.js";

runWorkerEntry({
	workload: {
		start: (invocation) => ({
			steer: () => true,
			interrupt: () => {},
			abort: () => {},
			result: Promise.resolve({
				status: "completed",
				// Report the input and whether the parent's secret leaked into
				// this process's environment (least-privilege assertion).
				outputText: `echo:${invocation.input};secret:${process.env.WORKER_TEST_SECRET ?? "unset"}`,
			}),
		}),
	},
});
