import type { SessionRecordedModelCall } from "@cline/shared";

/**
 * Full message blob list of every request, keyed by call index, following
 * each record's `messagePrefix`. Records whose prefix names a missing call
 * or overruns it are reported in `errors` and left out.
 */
export function resolveRecordedRequestMessages(
	records: readonly Pick<SessionRecordedModelCall, "callIndex" | "request">[],
): { messages: Map<number, string[]>; errors: string[] } {
	const messages = new Map<number, string[]>();
	const errors: string[] = [];
	const sorted = [...records].sort((a, b) => a.callIndex - b.callIndex);
	for (const record of sorted) {
		const { messagePrefix, messageSha256s, messageCount } = record.request;
		let prefix: string[] = [];
		if (messagePrefix) {
			const base =
				messagePrefix.callIndex < record.callIndex
					? messages.get(messagePrefix.callIndex)
					: undefined;
			if (!base || base.length < messagePrefix.count) {
				errors.push(
					`model call ${record.callIndex} shares ${messagePrefix.count} messages with call ${messagePrefix.callIndex}, which ${base ? `has only ${base.length}` : "is not an earlier recorded call"}`,
				);
				continue;
			}
			prefix = base.slice(0, messagePrefix.count);
		}
		const resolved = [...prefix, ...messageSha256s];
		if (resolved.length !== messageCount) {
			errors.push(
				`model call ${record.callIndex} resolves to ${resolved.length} messages but records messageCount ${messageCount}`,
			);
			continue;
		}
		messages.set(record.callIndex, resolved);
	}
	return { messages, errors };
}
