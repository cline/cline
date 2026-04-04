export type Disposable =
	| (() => void | Promise<void>)
	| { dispose: () => void | Promise<void> };

const registry: Disposable[] = [];

/**
 * Register a disposable to be cleaned up when `disposeAll()` is called.
 * Accepts either a function or an object with a `dispose` method.
 */
export function registerDisposable(disposable: Disposable): void {
	registry.push(disposable);
}

/**
 * Dispose all registered disposables in registration order.
 * Errors from individual disposables are suppressed so all run.
 */
export async function disposeAll(): Promise<void> {
	const items = registry.splice(0);
	await Promise.all(
		items.map((d) => {
			try {
				const result = typeof d === "function" ? d() : d.dispose();
				return result ?? Promise.resolve();
			} catch {
				return Promise.resolve();
			}
		}),
	);
}
