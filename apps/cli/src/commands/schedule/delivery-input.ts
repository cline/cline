import { type Command, Option } from "commander";
import {
	checkScheduleDelivery,
	DELIVERY_ADAPTERS,
	type DeliveryField,
	type DeliveryIssue,
	type DeliveryStringKey,
	isDeliveryObject,
} from "../../connectors/schedule-delivery";

/** The delivery flags, each paired with the delivery key it sets. */
const DELIVERY_FLAGS = [
	{
		key: "adapter",
		flags: "--delivery-adapter <name>",
		description: `Connector that posts each run's result: ${DELIVERY_ADAPTERS.join(", ")}`,
	},
	{
		key: "userName",
		flags: "--delivery-bot <name>",
		description: "Only this bot posts the result, when several are running",
	},
	{
		key: "threadId",
		flags: "--delivery-thread <id>",
		description: "Chat to post the result to; /whereami in the chat shows it",
	},
] as const satisfies ReadonlyArray<{
	key: DeliveryStringKey;
	flags: string;
	description: string;
}>;

export function addDeliveryOptions(cmd: Command): Command {
	for (const { flags, description } of DELIVERY_FLAGS) {
		cmd.addOption(new Option(flags, description));
	}
	return cmd;
}

function flagDelivery(
	opts: Record<string, unknown>,
): Record<string, string> | undefined {
	const delivery: Record<string, string> = {};
	for (const { key, flags } of DELIVERY_FLAGS) {
		const value = opts[new Option(flags).attributeName()];
		if (typeof value === "string" && value.trim()) {
			delivery[key] = value.trim();
		}
	}
	return Object.keys(delivery).length > 0 ? delivery : undefined;
}

/** Whether the parsed options set any delivery flag. */
export function hasDeliveryFlags(opts: Record<string, unknown>): boolean {
	return flagDelivery(opts) !== undefined;
}

/**
 * A metadata object from the user: `--metadata-json`, or an import file's
 * `metadata`. Messages name a field in it by `label`, then its JSON path;
 * `objectPath` is where the object sits in that input, if not at the top.
 */
export type MetadataInput = {
	object: Record<string, unknown>;
	label: string;
	objectPath?: string;
};

/**
 * One input that sets a schedule's delivery. Inputs merge in this order,
 * each overriding the one before: the schedule as stored, a metadata
 * object, then the delivery flags.
 */
type DeliveryInput =
	| { kind: "stored"; delivery: unknown }
	| { kind: "metadata"; source: MetadataInput; delivery: unknown }
	| { kind: "flags"; delivery: Record<string, string> };

/**
 * The metadata to save: `stored`, with the keys of `metadata` over it, and
 * the delivery merged from all three inputs. Returns `undefined` when there
 * is none.
 *
 * Throws one error listing every reason the delivery could never be posted,
 * each naming the flag or JSON path to change. A delivery set only by the
 * stored schedule is not checked, so that other edits to an old schedule
 * still work, and `"delivery": null` in `metadata` removes the delivery.
 */
export function scheduleMetadata(input: {
	stored?: Record<string, unknown>;
	metadata?: MetadataInput;
	flags?: Record<string, unknown>;
}): Record<string, unknown> | undefined {
	const { stored, metadata } = input;
	const flags = input.flags ? flagDelivery(input.flags) : undefined;
	const inputs: DeliveryInput[] = [];
	if (stored && stored.delivery !== undefined) {
		inputs.push({ kind: "stored", delivery: stored.delivery });
	}
	if (metadata && Object.hasOwn(metadata.object, "delivery")) {
		inputs.push({
			kind: "metadata",
			source: metadata,
			delivery: metadata.object.delivery,
		});
	}
	if (flags) {
		inputs.push({ kind: "flags", delivery: flags });
	}
	if (!stored && !metadata && !flags) {
		return undefined;
	}
	const next = { ...stored, ...metadata?.object };
	const merged = mergeDelivery(inputs);
	if (!merged) {
		return next;
	}
	const changed = inputs.some((item) => item.kind !== "stored");
	if (changed && merged.value !== null) {
		const issues = checkScheduleDelivery(merged.value);
		if (issues.length > 0) {
			throw new Error(
				issues.map((issue) => describeIssue(issue, merged)).join("\n"),
			);
		}
	}
	next.delivery = merged.value;
	return next;
}

type MergedDelivery = {
	value: unknown;
	/** The input each key of `value` came from. */
	sources: Map<string, DeliveryInput>;
	/** The last input to change the delivery. */
	last: DeliveryInput;
};

/**
 * Merges `inputs`, which are in precedence order. A stored or metadata
 * delivery replaces the delivery before it. Flags set their keys in the
 * delivery before them, or start a new one when there is none or it is
 * `null`. Flags can't fix a delivery that is some other value, so that
 * value stays for the check to report.
 */
function mergeDelivery(inputs: DeliveryInput[]): MergedDelivery | undefined {
	let merged: MergedDelivery | undefined;
	for (const input of inputs) {
		const extendsBefore =
			input.kind === "flags" && merged !== undefined && merged.value !== null;
		if (!merged || !extendsBefore) {
			merged = { value: input.delivery, sources: new Map(), last: input };
		} else if (isDeliveryObject(merged.value)) {
			merged.value = { ...merged.value, ...input.delivery };
		}
		merged.last = input;
		if (isDeliveryObject(input.delivery)) {
			for (const key of Object.keys(input.delivery)) {
				merged.sources.set(key, input);
			}
		}
	}
	return merged;
}

/**
 * Words `issue` for the input to change: the one that set the field at
 * fault, or, for a missing field, the last input to change the delivery.
 */
function describeIssue(issue: DeliveryIssue, merged: MergedDelivery): string {
	const where = locate(
		issue.field,
		merged.sources.get(issue.field) ?? merged.last,
	);
	switch (issue.kind) {
		case "notObject":
			return `${where} must be an object, or null to remove the delivery`;
		case "notString":
			return `${where} must be a string`;
		case "unknownAdapter":
			return `${where} is "${issue.value}"; use one of: ${DELIVERY_ADAPTERS.join(", ")}`;
		case "missingAdapter":
			return `schedule delivery needs ${where}, such as telegram or slack`;
		case "missingTarget":
			return `schedule delivery needs ${where}: send /whereami in the chat to get it`;
	}
}

/**
 * Names `field` as a JSON path when `input` is a metadata object, and
 * otherwise as the flag that sets it. Only a field the flags don't set, of
 * a delivery from the stored schedule, falls back to its metadata path.
 */
function locate(field: DeliveryField, input: DeliveryInput): string {
	const path = field === "delivery" ? "delivery" : `delivery.${field}`;
	if (input.kind === "metadata") {
		return `${input.source.label} ${input.source.objectPath ?? ""}${path}`;
	}
	const flag = DELIVERY_FLAGS.find((entry) => entry.key === field);
	return flag ? flag.flags : `metadata ${path}`;
}
