import { CONNECTOR_CATALOG } from "./catalog";

/**
 * `metadata.delivery` on a schedule tells a connector where to post each
 * run's result. An adapter posts only when `adapter` is exactly its catalog
 * name, and only to a chat it can find from `threadId`, `bindingKey` or
 * `participantKey`. `userName` picks one bot when several run. Adapters
 * ignore other keys and treat a missing, null or blank string as unset.
 */
export const DELIVERY_TARGET_KEYS = [
	"threadId",
	"bindingKey",
	"participantKey",
] as const;

export const DELIVERY_STRING_KEYS = [
	"adapter",
	...DELIVERY_TARGET_KEYS,
	"userName",
] as const;

export type DeliveryStringKey = (typeof DELIVERY_STRING_KEYS)[number];

/**
 * A reason a delivery can never be posted. `field` is where the user fixes
 * it: the field at fault, or the field to add when one is missing.
 */
export type DeliveryIssue =
	| { kind: "notObject"; field: "delivery" }
	| { kind: "notString"; field: DeliveryStringKey }
	| { kind: "unknownAdapter"; field: "adapter"; value: string }
	| { kind: "missingAdapter"; field: "adapter" }
	| { kind: "missingTarget"; field: "threadId" };

export type DeliveryField = DeliveryIssue["field"];

/** The connector names a delivery's `adapter` can take. */
export const DELIVERY_ADAPTERS: readonly string[] = CONNECTOR_CATALOG.map(
	(entry) => entry.name,
);

export function isDeliveryObject(
	value: unknown,
): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Returns every reason `delivery` can never be posted, or an empty list.
 * A field of the wrong type is reported once, as that, and not also as
 * missing.
 */
export function checkScheduleDelivery(delivery: unknown): DeliveryIssue[] {
	if (!isDeliveryObject(delivery)) {
		return [{ kind: "notObject", field: "delivery" }];
	}
	const issues: DeliveryIssue[] = [];
	const wrongType = new Set<DeliveryStringKey>();
	const set = new Map<DeliveryStringKey, string>();
	for (const key of DELIVERY_STRING_KEYS) {
		const value = delivery[key];
		if (value === undefined || value === null) {
			continue;
		}
		if (typeof value !== "string") {
			wrongType.add(key);
			issues.push({ kind: "notString", field: key });
		} else if (value.trim()) {
			set.set(key, value);
		}
	}
	const adapter = set.get("adapter");
	if (adapter === undefined) {
		if (!wrongType.has("adapter")) {
			issues.push({ kind: "missingAdapter", field: "adapter" });
		}
	} else if (!DELIVERY_ADAPTERS.includes(adapter)) {
		issues.push({ kind: "unknownAdapter", field: "adapter", value: adapter });
	}
	if (!DELIVERY_TARGET_KEYS.some((key) => set.has(key) || wrongType.has(key))) {
		issues.push({ kind: "missingTarget", field: "threadId" });
	}
	return issues;
}
