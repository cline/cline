import * as os from "node:os";
import { resolveCoreDistinctId } from "@cline/core";
import type {
	ClientContext,
	ExtensionContext,
	TelemetryMetadata,
	UserContext,
} from "@cline/shared";
import { version } from "../package.json";

/** Shared identity for request headers, Hub attribution, and telemetry. */
export const DESKTOP_CLIENT_CONTEXT = {
	name: "cline-desktop",
	version,
	platform: "Cline Desktop",
	platformVersion: version,
	isMultiRoot: false,
} as const satisfies ClientContext;

export const DESKTOP_TELEMETRY_METADATA = {
	extension_version: version,
	cline_type: "desktop",
	platform: DESKTOP_CLIENT_CONTEXT.platform,
	platform_version: DESKTOP_CLIENT_CONTEXT.platformVersion,
	os_type: os.platform(),
	os_version: os.version(),
} satisfies TelemetryMetadata;

export function resolveDesktopTelemetryUser(input?: {
	accountId?: string;
	email?: string;
	organizationId?: string;
}): UserContext {
	const accountId = input?.accountId?.trim();
	return accountId
		? {
				distinctId: accountId,
				accountId,
				email: input?.email,
				organizationId: input?.organizationId,
			}
		: {
				distinctId: resolveCoreDistinctId(),
				accountId: null,
			};
}

/** Serializable context attached to every Desktop session sent to the Hub. */
export function createDesktopExtensionContext(
	user?: UserContext,
): ExtensionContext {
	return {
		client: DESKTOP_CLIENT_CONTEXT,
		...(user ? { user: { ...user } } : {}),
	};
}
