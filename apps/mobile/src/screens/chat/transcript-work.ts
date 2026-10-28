import type { MessageBlock, RunStatus, SessionMessageView } from "@/session";

export interface TranscriptRow extends SessionMessageView {
	work?: { toolCallCount: number; children: TranscriptRow[] };
	parentWorkId?: string;
	sourceMessageIds?: string[];
}
type Part = { message: SessionMessageView; block: MessageBlock };

/** Render-only folding: canonical messages and a mixed streaming message share one layout. */
export function buildTranscriptWork(
	messages: readonly SessionMessageView[],
	options: { runStatus: RunStatus; blocked?: boolean },
): TranscriptRow[] {
	const rows: TranscriptRow[] = [];
	const usedIds = new Set<string>();
	const push = (row: TranscriptRow) => {
		rows.push(row);
		usedIds.add(row.id);
	};
	let span: Part[] = [];
	let turn = 0;
	let segment = 0;
	const appendParts = (parts: Part[]) => {
		let previousSource: string | undefined;
		let previousRow: TranscriptRow | undefined;
		for (const part of parts) {
			if (previousRow && previousSource === part.message.id) {
				previousRow.blocks.push(part.block);
			} else {
				const id = usedIds.has(part.message.id)
					? `${part.message.id}:segment:${segment}`
					: part.message.id;
				previousRow = {
					...part.message,
					id,
					blocks: [part.block],
					sourceMessageIds: [part.message.id],
				};
				previousSource = part.message.id;
				push(previousRow);
			}
		}
	};
	const flush = (settled: boolean, deliverableBoundary = false) => {
		if (!span.length) return;
		const tools = span.filter((part) => part.block.kind === "tool");
		const lastTool = span.findLastIndex((part) => part.block.kind === "tool");
		const answerStart = span.findIndex(
			(part, index) =>
				index > lastTool &&
				part.block.kind === "text" &&
				Boolean(part.block.text.trim()),
		);
		const safe = tools.every(
			(part) => part.block.kind === "tool" && part.block.state === "completed",
		);
		if (
			!settled ||
			!tools.length ||
			!safe ||
			(answerStart < 0 && !deliverableBoundary)
		) {
			appendParts(span);
		} else {
			const work = answerStart < 0 ? span : span.slice(0, answerStart);
			const first = work[0]!;
			const firstTool = tools[0]!.block;
			const id = `work:${turn}:${segment}:${firstTool.kind === "tool" ? firstTool.toolCallId : "tool"}`;
			const children = work.map((part, index) => ({
				...part.message,
				id: `${id}:part:${index}`,
				blocks: [part.block],
				parentWorkId: id,
				sourceMessageIds: [part.message.id],
			}));
			push({
				...first.message,
				id,
				blocks: work.map((part) => part.block),
				work: { toolCallCount: tools.length, children },
				sourceMessageIds: [...new Set(work.map((part) => part.message.id))],
			});
			if (answerStart >= 0) {
				const answer = span.slice(answerStart);
				const source = answer[0]!.message;
				const answerId = usedIds.has(source.id)
					? `${source.id}:answer:${segment}`
					: source.id;
				push({
					...source,
					id: answerId,
					blocks: answer.map((part) => part.block),
					sourceMessageIds: [...new Set(answer.map((part) => part.message.id))],
				});
			}
		}
		span = [];
		segment += 1;
	};
	const trailingSettled =
		!options.blocked && ["idle", "completed"].includes(options.runStatus);
	for (const message of messages) {
		if (message.role === "user" || message.displayRole === "error") {
			flush(message.role === "user", message.role === "user");
			push({ ...message, blocks: [...message.blocks] });
			if (message.role === "user") {
				turn += 1;
				segment = 0;
			}
			continue;
		}
		for (const block of message.blocks) {
			// Core's submit_and_exit carries the final report in input.summary;
			// its result only echoes execution status, not the authored deliverable.
			if (
				block.kind === "tool" &&
				block.name.toLowerCase() === "submit_and_exit" &&
				block.state === "completed" &&
				block.input &&
				typeof block.input === "object" &&
				"summary" in block.input &&
				typeof block.input.summary === "string" &&
				block.input.summary.trim()
			) {
				span.push({
					message,
					block: { kind: "text", text: block.input.summary },
				});
				continue;
			}
			if (block.kind === "media") {
				flush(trailingSettled, true);
				push({
					...message,
					id: `${message.id}:media:${block.media.id}`,
					blocks: [block],
					sourceMessageIds: [message.id],
				});
			} else {
				span.push({ message, block });
			}
		}
	}
	flush(trailingSettled);
	return rows;
}
