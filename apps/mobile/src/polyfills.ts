/**
 * Platform polyfills that MUST be installed before the application graph is
 * evaluated.
 *
 * They live in their own module for a reason: ES module imports are hoisted, so
 * a bare `if (...) { ... }` statement in `index.js` would run *after* every
 * `import` in that file — including `import "expo-router/entry"`, which pulls in
 * the whole app. A static import of a side-effecting module, by contrast, runs in
 * source order relative to the other imports, so importing this module before
 * `expo-router/entry` genuinely installs the polyfills first.
 */

interface AbortSignalTimeoutHost {
	AbortSignal?: { timeout?: unknown };
	AbortController?: new () => { abort(): void; signal: unknown };
	setTimeout?: (callback: () => void, delay: number) => unknown;
}

/**
 * Install `AbortSignal.timeout` when the runtime lacks it.
 *
 * The shared Cline device-auth implementation (`@cline/core/auth/cline-device`)
 * passes `AbortSignal.timeout(...)` to `fetch`; older Hermes builds do not ship
 * it. Returns whether it installed a replacement.
 */
export function installAbortSignalTimeout(
	host: AbortSignalTimeoutHost = globalThis as AbortSignalTimeoutHost,
): boolean {
	const { AbortSignal: signalCtor, AbortController: controllerCtor } = host;
	if (!signalCtor || !controllerCtor) {
		return false;
	}
	if (typeof signalCtor.timeout === "function") {
		return false;
	}
	const schedule = host.setTimeout ?? setTimeout;
	signalCtor.timeout = (delay: number) => {
		const controller = new controllerCtor();
		schedule(() => controller.abort(), delay);
		return controller.signal;
	};
	return true;
}

installAbortSignalTimeout();
