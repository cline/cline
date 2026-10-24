import { writeExecutionTargetToWindow } from "./model-selection";

export function createLocalEnvironmentSelection() {
	let pending = 0;
	return {
		async select(disconnect: () => Promise<void>, selectDraft: () => void) {
			pending += 1;
			try {
				await disconnect();
				// Save Local after disconnect succeeds and before the draft mounts.
				writeExecutionTargetToWindow("local");
				selectDraft();
			} finally {
				pending -= 1;
			}
		},
		onDisconnected(selectDraft: () => void) {
			// Disconnect events arrive before the command replies; let select navigate.
			if (pending === 0) selectDraft();
		},
	};
}
