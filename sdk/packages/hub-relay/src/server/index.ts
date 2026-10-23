export {
	assertDevRelayBindAllowed,
	createDevVerifyAccount,
	DEV_ACCOUNT_TOKEN_PREFIX,
	DEV_MIN_REMOTE_TOKEN_LENGTH,
	type DevRelayBindRequest,
	deriveDevAccountToken,
	isLoopbackHost,
} from "./dev-auth";
export {
	type CreateRelayServerOptions,
	createRelayServer,
	type RelayAccount,
	type RelayMachineRecord,
	type RelayServer,
	type RelayServerEvent,
	type RelayServerLimits,
	type RelayServerStats,
	type VerifyAccount,
	type VerifyAccountContext,
} from "./server";
export {
	type CreateRelayTicketVerifyAccountOptions,
	createRelayTicketVerifyAccount,
} from "./ticket-auth";
