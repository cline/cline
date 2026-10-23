/**
 * `@cline/hub-testkit` is a test-only devDependency that boots the live hub
 * server from `@cline/core/hub`. That subpath is published from a `dist/` which
 * is not built in every checkout: vitest resolves it from source through an alias
 * (see `vitest.config.ts`), and `tsc` has no equivalent.
 *
 * Typechecking core's sources under this app's compiler options is not this
 * package's job, so the module is declared opaque here. Only the members the
 * testkit itself touches are described.
 */

declare module "@cline/core/hub" {
	export interface HubWebSocketServer {
		readonly url: string;
		readonly authToken: string;
		close(): Promise<void>;
	}
	export function startHubWebSocketServer(
		options: unknown,
	): Promise<HubWebSocketServer>;
	export function createLocalHubScheduleRuntimeHandlers(): unknown;
}
