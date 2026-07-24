/**
 * The asynchronous "computer user" helper agent.
 *
 * A driver agent delegates GUI work to a helper session on a separately
 * configured provider. The coordinator owns the helper's lifecycle: start,
 * status polling, steering messages, hard interruption, and driver callbacks
 * (notes, questions, completion reports) injected via the driver's
 * pending-prompt queue. See ./coordinator.ts for the state machine and
 * ../computer-observability for the replay artifact stream.
 */
export {
	ComputerUserCoordinator,
	type ComputerUserCoordinatorOptions,
	type ComputerUserSessionHost,
	type ComputerUserState,
	type ComputerUserStatus,
	type DriverNotifier,
	type DriverQuestion,
	type HelperNote,
	type HelperRun,
} from "./coordinator";
export { createComputerUserDriverTools } from "./driver-tools";
export {
	COMPUTER_USER_PROMPT_VERSION,
	COMPUTER_USER_SYSTEM_PROMPT,
} from "./helper-prompt";
export { createComputerUserCollaborationTools } from "./helper-tools";
