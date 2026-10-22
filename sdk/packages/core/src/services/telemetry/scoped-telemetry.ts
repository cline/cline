import type {
	ClientContext,
	ITelemetryService,
	TelemetryMetadata,
	TelemetryProperties,
	UserContext,
} from "@cline/shared";
import { resolveClientSessionSource } from "../../session/history-origin";

/**
 * Client identity that can safely cross a runtime boundary and be attached to
 * telemetry emitted by the process that actually executes a session.
 */
export interface ClientTelemetryContext {
	client: ClientContext;
	source?: string;
	user?: UserContext;
}

function trimNonEmpty(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

/**
 * Converts the shared client context into the established cross-surface
 * analytics dimensions. Event-specific fields still take precedence.
 */
export function resolveClientTelemetryProperties(
	context: ClientTelemetryContext,
): TelemetryProperties {
	const client = context.client;
	const clineType =
		resolveClientSessionSource(client) ?? trimNonEmpty(context.source);
	const version = trimNonEmpty(client.version);
	const platform = trimNonEmpty(client.platform) ?? trimNonEmpty(client.name);
	const platformVersion = trimNonEmpty(client.platformVersion) ?? version;
	const clientProperties: TelemetryProperties = {
		cline_type: clineType,
		extension_version: version,
		platform,
		platform_version: platformVersion,
	};
	if (context.user?.accountId === undefined) {
		return clientProperties;
	}
	const accountId =
		typeof context.user.accountId === "string"
			? trimNonEmpty(context.user.accountId)
			: undefined;
	return {
		...clientProperties,
		// `undefined` deliberately masks stale process-level account fields.
		// TelemetryService removes it after merging all attribute layers.
		distinct_id: accountId ?? trimNonEmpty(context.user.distinctId),
		user_id: accountId,
		account_id: accountId,
		account_email: accountId ? trimNonEmpty(context.user.email) : undefined,
		organization_id: accountId
			? trimNonEmpty(context.user.organizationId)
			: undefined,
	};
}

/**
 * A non-owning view over a host telemetry service. It adds immutable
 * per-session properties without mutating the host singleton, which is
 * essential for a Hub process that can execute sessions from several clients
 * concurrently.
 *
 * The returned view never disposes the parent. The process that created the
 * parent telemetry service remains responsible for its lifecycle.
 */
export function createScopedTelemetryService(
	parent: ITelemetryService,
	properties: TelemetryProperties,
): ITelemetryService {
	let metadata: Partial<TelemetryMetadata> = {};
	let commonProperties: TelemetryProperties = {};
	let distinctId: string | undefined;

	const merge = (
		eventProperties?: TelemetryProperties,
	): TelemetryProperties => ({
		...properties,
		...commonProperties,
		...metadata,
		...eventProperties,
		...(distinctId ? { distinct_id: distinctId } : {}),
	});

	return {
		setDistinctId(value) {
			distinctId = trimNonEmpty(value);
		},
		setMetadata(value) {
			metadata = { ...value };
		},
		updateMetadata(value) {
			metadata = { ...metadata, ...value };
		},
		setCommonProperties(value) {
			commonProperties = { ...value };
		},
		updateCommonProperties(value) {
			commonProperties = { ...commonProperties, ...value };
		},
		isEnabled: () => parent.isEnabled(),
		capture: (input) =>
			parent.capture({
				event: input.event,
				properties: merge(input.properties),
			}),
		captureRequired: (event, eventProperties) =>
			parent.captureRequired(event, merge(eventProperties)),
		recordCounter: (name, value, attributes, description, required) =>
			parent.recordCounter(
				name,
				value,
				merge(attributes),
				description,
				required,
			),
		recordHistogram: (name, value, attributes, description, required) =>
			parent.recordHistogram(
				name,
				value,
				merge(attributes),
				description,
				required,
			),
		recordGauge: (name, value, attributes, description, required) =>
			parent.recordGauge(name, value, merge(attributes), description, required),
		flush: () => parent.flush(),
		dispose: async () => {},
	};
}

/**
 * Scopes a host telemetry singleton to one runtime client. This is the
 * reusable bridge used by Hub-hosted sessions; local clients that already
 * provide their own telemetry service do not need it.
 */
export function createClientScopedTelemetryService(
	parent: ITelemetryService,
	context: ClientTelemetryContext,
): ITelemetryService {
	return createScopedTelemetryService(
		parent,
		resolveClientTelemetryProperties(context),
	);
}
