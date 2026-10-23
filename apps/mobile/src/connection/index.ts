/**
 * The connection layer: everything a screen needs to turn a hub endpoint into a
 * live, driven session.
 *
 * ```ts
 * const { view, status, sendInput, respondApproval } = useSessionConnection({
 *   mode: "local",
 *   url: "ws://127.0.0.1:4599/hub",
 *   authToken,
 * });
 * ```
 *
 * `useSessionConnection` is the single API the Chat screen calls. Underneath,
 * {@link SessionConnectionController} owns the tested session core and
 * {@link createLocalSessionHandle} builds the direct-hub handle for the local
 * path. {@link SavedEndpointsStore} remembers hubs between launches.
 */

export {
	type ConnectionPhase,
	type ConnectionSnapshot,
	type ConnectionStatus,
	SessionConnectionController,
	type SessionConnectionControllerDeps,
} from "./controller";
export {
	type ChatRouteParams,
	type ConnectionDescriptor,
	type ConnectionMode,
	chatRouteParams,
	createExpoSecureStoreAdapter,
	descriptorKey,
	type EndpointPersistence,
	SavedEndpointsStore,
} from "./endpoints";
export {
	type CreateLocalSessionHandleOptions,
	createLocalSessionHandle,
} from "./local-handle";
export {
	type LocalTransport,
	type ResolveLocalTransportDeps,
	resolveLocalTransport,
} from "./local-transport";
export {
	RelayTicketError,
	type RequestRelayTicketOptions,
	requestRelayTicket,
} from "./relay-ticket";
export {
	type UseSessionConnection,
	useSessionConnection,
} from "./use-session-connection";
