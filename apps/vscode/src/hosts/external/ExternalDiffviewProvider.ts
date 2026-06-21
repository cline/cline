// Inert stub: the standalone diff view implementation has been removed from this
// shell. This class only exists so the standalone host provider factory still
// has something to construct. All methods are no-ops.
export class ExternalDiffViewProvider {
	async openDiffEditor(): Promise<void> {
		throw new Error("removed")
	}
}
