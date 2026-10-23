/**
 * Cline Cloud data/auth foundation for the mobile app.
 *
 * - `auth/*` — shared Cline device auth + mobile SecureStore persistence.
 * - `rest/CloudSessionGateway` — the real {@link RemoteSessionGateway}.
 *
 * The connection handle that ties these to the session core lives at
 * `../connection/cloud-handle`.
 */

export * from "./auth";
export {
	type CloudGitHubAction,
	CloudGitHubApiError,
	CloudGitHubGateway,
	type CloudGitHubGatewayOptions,
} from "./rest/CloudGitHubGateway";
export {
	CloudSessionApiError,
	CloudSessionGateway,
	type CloudSessionGatewayOptions,
	CloudSessionResponseError,
	type CreatedRemoteSession,
	type CreateRemoteSessionInput,
	type CreateRemoteSessionOptions,
	type CreateRemoteSessionResult,
	GitHubIntegrationRequiredError,
	mapRemoteSessionStatus,
} from "./rest/CloudSessionGateway";
export {
	type CloudModelOption,
	type CloudRepository,
	CloudSetupApiError,
	CloudSetupGateway,
} from "./rest/CloudSetupGateway";
