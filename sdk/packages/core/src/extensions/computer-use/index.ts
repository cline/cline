/**
 * Computer-use tool integration.
 *
 * A genuine `@cline/core` extension (an `AgentTool`, usable via
 * `CoreSessionConfig.extraTools` from any host), kept in its own folder with
 * a minimal dependency surface (`@cline/shared` types only) so it can be
 * extracted into a standalone Cline plugin later with minimal changes. See
 * ./protocol.ts for the wire format and ./README.md for the backend
 * contract and design rationale.
 */
export {
	ComputerUseClient,
	type ComputerUseClientEvent,
	type ComputerUseClientObserver,
	type ComputerUseClientOptions,
	type ComputerUseSendOptions,
} from "./client";
export { createComputerUseToolFromEnv } from "./env";
export type {
	ComputerUseAction,
	ComputerUseCoordinate,
	ComputerUseDisplayInfo,
	ComputerUseImage,
	ComputerUseRequest,
	ComputerUseResponse,
} from "./protocol";
export { GET_DISPLAY_INFO_ACTION, isComputerUseResponse } from "./protocol";
export { type ComputerUseToolOptions, createComputerUseTool } from "./tool";
