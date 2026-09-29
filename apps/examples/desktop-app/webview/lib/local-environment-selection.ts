import { writeExecutionTargetToWindow } from "./model-selection";

/** Coordinate the disconnect event with the command that explicitly picks Local. */
export function createLocalEnvironmentSelection() {
	let pending = 0;
	return {
		async select(disconnect: () => Promise<void>, selectDraft: () => void) {
			pending += 1;
			try {
				await disconnect();
				// A newly mounted draft must read Local, but a failed disconnect
				// must not change the user's remembered target.
				writeExecutionTargetToWindow("local");
				selectDraft();
			} finally {
				pending -= 1;
			}
		},
		onDisconnected(selectDraft: () => void) {
			// The sidecar broadcasts before replying. The explicit selection
			// owns navigation until its command settles, including deferred UI.
			if (pending === 0) selectDraft();
		},
	};
}
