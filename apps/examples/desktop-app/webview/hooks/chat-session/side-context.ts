import type { ChatMessage } from "@/lib/chat-schema";
import {
	referenceByteLength,
	referenceExcerpt,
	SIDE_EXCERPT_BUDGET_BYTES,
	SIDE_VISIBLE_BUDGET_BYTES,
	type SideVisibleContext,
	sanitizeReferenceText,
	serializeReferenceData,
} from "../../../shared/side-conversation";

export function captureVisibleSideContext({
	messages,
	sessionId,
	environmentId,
	queuedIds,
	unconfirmedIds,
}: {
	messages: readonly ChatMessage[];
	sessionId: string;
	environmentId: string;
	queuedIds: ReadonlySet<string>;
	unconfirmedIds: ReadonlySet<string>;
}): SideVisibleContext {
	const eligible = messages.filter(
		(message) =>
			message.sessionId === sessionId &&
			!queuedIds.has(message.id) &&
			(message.role === "assistant" ||
				message.role === "tool" ||
				(message.role === "user" && (message.meta?.userRunSpan ?? 1) === 1)),
	);
	const lastUser = eligible.findLastIndex((message) => message.role === "user");
	const current = eligible.slice(Math.max(0, lastUser));
	const capture: SideVisibleContext = {
		sessionId,
		environmentId,
		capturedAt: new Date().toISOString(),
		excerpts: [],
		omittedExcerptCount: 0,
		omittedMediaCount: current.reduce(
			(count, message) =>
				count + (message.images?.length ?? 0) + (message.media?.length ?? 0),
			0,
		),
	};
	const selected = new Map<number, SideVisibleContext["excerpts"][number]>();
	const include = (index: number) => {
		const message = current[index];
		if (!message || selected.has(index)) return;
		if (
			message.role !== "user" &&
			message.role !== "assistant" &&
			message.role !== "tool"
		)
			return;
		let text = message.content;
		if (message.role === "tool") {
			try {
				text = serializeReferenceData(JSON.parse(text));
			} catch {
				text = sanitizeReferenceText(text);
			}
			text += message.meta?.toolOutput
				? `\n${sanitizeReferenceText(message.meta.toolOutput)}`
				: "";
			if (message.meta?.hookEventName !== "tool_call_end")
				text +=
					"\n[tool observation in progress; result may not yet be available]";
		} else text = sanitizeReferenceText(text);
		if (!text.trim()) return;
		const jsonExpansion =
			referenceByteLength(JSON.stringify(text)) / referenceByteLength(text);
		const clipped = referenceExcerpt(
			text,
			Math.floor((SIDE_EXCERPT_BUDGET_BYTES - 128) / jsonExpansion),
		);
		const excerpt: SideVisibleContext["excerpts"][number] = {
			messageId: message.id,
			role: message.role,
			text: clipped.text,
			runCount: message.meta?.runCount,
			submission:
				message.role === "user" &&
				(unconfirmedIds.has(message.id) || message.meta?.runCount === undefined)
					? "unconfirmed"
					: "observed",
			omittedBytes: clipped.omittedBytes,
		};
		const next = [...selected.values(), excerpt];
		if (
			next.length <= 12 &&
			referenceByteLength(JSON.stringify({ ...capture, excerpts: next })) <=
				SIDE_VISIBLE_BUDGET_BYTES - 128
		)
			selected.set(index, excerpt);
	};
	if (current[0]?.role === "user") include(0);
	for (let index = current.length - 1; index >= 0; index--) include(index);
	capture.excerpts = [...selected]
		.sort(([a], [b]) => a - b)
		.map(([, value]) => value);
	capture.omittedExcerptCount = current.length - selected.size;
	return capture;
}
