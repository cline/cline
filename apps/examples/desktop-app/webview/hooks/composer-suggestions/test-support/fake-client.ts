import { vi } from "vitest";
import type { DesktopTransportState } from "@/lib/desktop-transport";

type EventHandler = (payload: unknown) => void;
type TransportHandler = (state: DesktopTransportState) => void;
type InvokeArgs = Record<string, unknown> | undefined;

/**
 * A stand-in for `@/lib/desktop-client` with no runtime app imports, so a test's
 * `vi.mock` factory can load it before the hook under test: `invoke` is a
 * mock, `emit` delivers a sidecar event, `setTransportState` drops and
 * restores the socket.
 */
function createFakeDesktopClient() {
	const handlers = new Map<string, Set<EventHandler>>();
	const transportHandlers = new Set<TransportHandler>();
	let transportState: DesktopTransportState = "connected";
	const invoke =
		vi.fn<(command: string, args?: InvokeArgs) => Promise<unknown>>();
	const openExternalUrl = vi.fn(async (_url: string) => undefined);
	return {
		invoke,
		openExternalUrl,
		client: {
			invoke,
			subscribe(eventName: string, handler: EventHandler): () => void {
				const set = handlers.get(eventName) ?? new Set<EventHandler>();
				set.add(handler);
				handlers.set(eventName, set);
				return () => {
					set.delete(handler);
				};
			},
			subscribeTransportState(handler: TransportHandler): () => void {
				transportHandlers.add(handler);
				handler(transportState);
				return () => {
					transportHandlers.delete(handler);
				};
			},
			getTransportState: () => transportState,
			getTransportError: () => null,
		},
		emit(eventName: string, payload: unknown): void {
			for (const handler of [...(handlers.get(eventName) ?? [])]) {
				handler(payload);
			}
		},
		setTransportState(state: DesktopTransportState): void {
			transportState = state;
			for (const handler of [...transportHandlers]) handler(state);
		},
		reset(): void {
			handlers.clear();
			transportHandlers.clear();
			transportState = "connected";
			invoke.mockReset();
			openExternalUrl.mockClear();
		},
	};
}

export const fakeDesktop = createFakeDesktopClient();
