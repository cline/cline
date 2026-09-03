/**
 * CLI terminal renderer on the v2 frame stream (Phase 2 of the agent
 * event stream design). Implements the assembler's consumer API; the
 * hand-rolled v1 parser state (activeInlineStream etc.) collapses to
 * per-renderer visual state, and stream structure is the assembler's
 * job.
 *
 * Fidelity notes (differential-tested against the v1 reference):
 * - Text block closes ignore the final text: v1 streamed text via
 *   deltas only, and finals with no deltas printed nothing — the v1
 *   quirk is preserved deliberately.
 * - Recoverable errors arrive as `recovery` notices; the verbose-only
 *   display rule is v1's.
 * - One intended divergence (the P6 fix, whitelisted in the
 *   differential test): `done(reason:"error")` renders as an error
 *   rather than v1's fake "finished" banner.
 */
import {
	formatCompactionDividerLabel,
	parseCompactionNoticeMetadata,
} from "../tui/utils/compaction-status";
import type {
	CloseFinal,
	NoticeBody,
	Outcome,
	ReasoningStart,
	TextStart,
	ToolStart,
} from "@cline/shared";
import type {
	MediaFinal,
	SessionConsumer,
	TextSink,
	ReasoningSink,
	ToolSink,
	TurnConsumer,
} from "@cline/core";
import { formatCliErrorMessage } from "./cline-pass-errors";
import { materializeGeneratedMedia } from "./generated-media";
import { formatToolInput, formatToolOutput } from "./helpers";
import { c } from "./output";

const HOOK = "⎿ ";

export interface RendererIo {
	write: (text: string) => void;
	writeErr: (text: string) => void;
}

export interface RendererConfig {
	verbose: boolean;
	modelId?: string;
}

function formatResultLines(
	text: string,
	maxLines = 5,
): string[] {
	const lines = text.split("\n");
	if (lines.length <= maxLines) return lines;
	return [
		...lines.slice(0, maxLines),
		`... ${lines.length - maxLines} more lines`,
	];
}

/** Status label for a notice frame (mirrors the v1 label helpers). */
export function resolveFrameStatusLabel(
	frame: NoticeBody,
): string | undefined {
	if (frame.displayRole !== "status") {
		return undefined;
	}
	const compaction = frame.metadata
		? parseCompactionNoticeMetadata(frame.metadata)
		: undefined;
	if (compaction) {
		return formatCompactionDividerLabel({
			kind: "compaction",
			...compaction,
		});
	}
	switch (frame.reason) {
		case "auto_compaction":
			return "auto-compacting";
		case "manual_compaction":
			return "compacting";
		case "compaction_budget_emergency":
			return "context budget adjusted";
	}
	return frame.message?.trim() || undefined;
}

export class CliFrameRenderer implements SessionConsumer {
	private readonly config: RendererConfig;
	private readonly io: RendererIo;
	private activeInlineStream: "text" | "reasoning" | undefined;
	private inlineStreamHasOutput = false;

	constructor(config: RendererConfig, io: RendererIo) {
		this.config = config;
		this.io = io;
	}

	/** v1's exported close helper, kept for external callers (hooks). */
	closeInlineStreamIfNeeded(): void {
		if (!this.inlineStreamHasOutput) {
			return;
		}
		this.io.write("\n");
		this.activeInlineStream = undefined;
		this.inlineStreamHasOutput = false;
	}

	/** Team-handler probe: is a text stream visually open? */
	isActiveTextStream(): boolean {
		return this.activeInlineStream === "text";
	}

	/** v1's breakLineIfStreaming: end the visual line but keep the
	 * text stream active so the next chunk continues without a prefix. */
	breakLineIfStreaming(): void {
		if (this.activeInlineStream === "text" && this.inlineStreamHasOutput) {
			this.io.write("\n");
			this.inlineStreamHasOutput = false;
		}
	}

	private closeInline(): void {
		this.closeInlineStreamIfNeeded();
	}

	onTurn = (): TurnConsumer => ({
		onText: (): TextSink => {
			return {
				onDelta: (text: string): void => {
					if (this.activeInlineStream !== "text") {
						this.closeInline();
						this.activeInlineStream = "text";
					}
					this.io.write(text);
					this.inlineStreamHasOutput = true;
				},
				onAnnotation: (): void => {},
				onClose: (): void => {
					// v1 printed nothing for a text final (deltas only).
					this.closeInline();
				},
			};
		},
		onReasoning: (start: ReasoningStart): ReasoningSink => {
			this.closeInline();
			return {
				onDelta: (reasoning: string): void => {
					if (this.activeInlineStream !== "reasoning") {
						this.closeInline();
						this.io.write(`${c.dim}[thinking] ${c.reset}`);
						this.activeInlineStream = "reasoning";
						this.inlineStreamHasOutput = true;
					}
					if (reasoning === "" && start.redacted) {
						this.io.write(`${c.dim}[redacted]${c.reset}`);
						this.inlineStreamHasOutput = true;
						return;
					}
					this.io.write(`${c.dim}${reasoning}${c.reset}`);
					this.inlineStreamHasOutput = true;
				},
				onAnnotation: (): void => {},
				onClose: (): void => {
					this.closeInline();
				},
			};
		},
		onTool: (start: ToolStart): ToolSink => {
			this.closeInline();
			if (start.toolName !== "ask_question") {
				const inputStr = formatToolInput(start.toolName, start.input);
				this.io.write(
					`${c.cyan}[${start.toolName}]${c.reset}${inputStr ? ` ${inputStr}` : ""}\n`,
				);
			}
			return {
				onProgress: (): void => {
					// v1's inline CLI did not render tool progress.
				},
				onAnnotation: (): void => {},
				onClose: (outcome: Outcome, final: CloseFinal): void => {
					this.closeInline();
					if (start.toolName === "ask_question") {
						return;
					}
					if (outcome.kind === "interrupted") {
						// v1 printed nothing for a tool that never closed
						// (W3 dangling); the force-close must stay silent
						// too, or an interrupted tool would render "ok".
						return;
					}
					if (outcome.kind === "detached") {
						// Detached work survives the stream as a resource
						// handle; the block itself has no final output to
						// render. No producer emits this yet (Phase 3+).
						return;
					}
					if (outcome.kind === "error") {
						this.io.write(
							`   ${c.gray}${HOOK}${c.reset}${c.red}error: ${outcome.error.message}${c.reset}\n`,
						);
						return;
					}
					const output =
						final.type === "tool" ? formatToolOutput(final.output) : "";
					if (output) {
						const lines = formatResultLines(output);
						for (let i = 0; i < lines.length; i++) {
							const prefix = i === 0 ? HOOK : "  ";
							this.io.write(
								`   ${c.gray}${prefix}${c.reset}${c.dim}${lines[i]}${c.reset}\n`,
							);
						}
					} else {
						this.io.write(
							`   ${c.gray}${HOOK}${c.reset}${c.green}ok${c.reset}\n`,
						);
					}
				},
			};
		},
		onMedia: (media: MediaFinal): void => {
			this.closeInline();
			const generated = media.media as {
				modality: string;
				mediaType: string;
				source: { type: string; url?: string; artifactId?: string };
			};
			const saved = materializeGeneratedMedia(media.media as never);
			if (saved) {
				this.io.write(
					`${c.dim}[generated ${generated.modality}]${c.reset} ${saved.path}\n`,
				);
			} else if (generated.source.type === "url") {
				this.io.write(
					`${c.dim}[generated ${generated.modality}]${c.reset} ${generated.source.url}\n`,
				);
			} else if (generated.source.type === "artifact") {
				this.io.write(
					`${c.dim}[generated ${generated.modality}]${c.reset} artifact:${generated.source.artifactId}\n`,
				);
			} else {
				this.io.write(
					`${c.dim}[generated ${generated.modality}]${c.reset} ${generated.mediaType} could not be saved\n`,
				);
			}
		},
		onSubAgent: (): null => null,
		onNotice: (notice: NoticeBody): void => {
			if (
				notice.noticeType === "iteration_started" ||
				notice.noticeType === "iteration_finished"
			) {
				this.closeInline();
				return;
			}
			if (notice.noticeType === "recovery") {
				// v1 closed the inline stream on every error event, even
				// recoverable ones whose message was suppressed.
				this.closeInline();
				if (this.config.verbose && notice.message) {
					this.io.writeErr(
						formatCliErrorMessage(notice.message, {
							modelId: this.config.modelId,
						}),
					);
				}
				return;
			}
			if (notice.displayRole === "status") {
				this.closeInline();
				const label = resolveFrameStatusLabel(notice);
				if (label) {
					this.io.write(`\n${c.dim}[status]${c.reset} ${label}\n`);
				}
			}
		},
		onUsage: (): void => {
			// v1's inline renderer did not render usage.
		},
		onClose: (outcome: Outcome, iterations?: number): void => {
			this.closeInline();
			if (this.config.verbose && iterations !== undefined) {
				const label =
					outcome.kind === "interrupted" ? "aborted" : "finished";
				this.io.write(
					`\n${c.dim}── ${label} (${iterations} iterations) ──${c.reset}\n`,
				);
			}
			if (outcome.kind === "error") {
				this.io.writeErr(
					formatCliErrorMessage(outcome.error.message, {
						modelId: this.config.modelId,
					}),
				);
			}
			this.activeInlineStream = undefined;
			this.inlineStreamHasOutput = false;
		},
	});

	onSessionNotice(): void {}

	onIdle(): void {}

	onDiagnostic(diagnostic: { code: string; detail?: string }): void {
		this.io.writeErr(
			`${c.dim}[stream] ${diagnostic.code}${diagnostic.detail ? ` ${diagnostic.detail}` : ""}${c.reset}\n`,
		);
	}
}
