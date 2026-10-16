/**
 * v1 inline CLI renderer — the differential-test reference, extracted
 * verbatim from the pre-Phase-2 `handleEvent` (apps/cli/src/utils/
 * events.ts). NOT used by production; it exists so the differential
 * harness can prove the frame-path renderer byte-for-byte parity.
 * Deleted in Phase 5 when the migration is complete.
 */
import type { AgentEvent } from "@cline/core";
import {
	formatCompactionDividerLabel,
	parseCompactionNoticeMetadata,
} from "../tui/utils/compaction-status";
import { formatCliErrorMessage } from "./cline-pass-errors";
import { materializeGeneratedMedia } from "./generated-media";
import { formatToolInput, formatToolOutput } from "./helpers";
import { c } from "./output";
import type { RendererConfig, RendererIo } from "./frame-renderer";

const HOOK = "⎿ ";

function formatResultLines(text: string, maxLines = 5): string[] {
	const lines = text.split("\n");
	if (lines.length <= maxLines) return lines;
	return [...lines.slice(0, maxLines), `... ${lines.length - maxLines} more lines`];
}

export class V1ReferenceRenderer {
	private activeInlineStream: "text" | "reasoning" | undefined;
	private inlineStreamHasOutput = false;
	private shouldPrefixNextTextWithBlankLine = false;

	constructor(
		private readonly config: RendererConfig,
		private readonly io: RendererIo,
	) {}

	private closeInlineStreamIfNeeded(): void {
		if (!this.inlineStreamHasOutput) {
			return;
		}
		this.io.write("\n");
		this.activeInlineStream = undefined;
		this.inlineStreamHasOutput = false;
	}

	handleEvent(event: AgentEvent): void {
		switch (event.type) {
			case "iteration_start":
				this.closeInlineStreamIfNeeded();
				break;

			case "iteration_end":
				this.closeInlineStreamIfNeeded();
				break;

			case "content_start":
				switch (event.contentType) {
					case "text":
						if (this.activeInlineStream !== "text") {
							this.closeInlineStreamIfNeeded();
							if (this.shouldPrefixNextTextWithBlankLine) {
								this.io.write("\n");
								this.shouldPrefixNextTextWithBlankLine = false;
							}
							this.activeInlineStream = "text";
						}
						this.io.write(event.text ?? "");
						this.inlineStreamHasOutput = true;
						break;
					case "reasoning":
						if (this.activeInlineStream !== "reasoning") {
							this.closeInlineStreamIfNeeded();
							this.io.write(`${c.dim}[thinking] ${c.reset}`);
							this.activeInlineStream = "reasoning";
							this.inlineStreamHasOutput = true;
						}
						if (event.redacted && !event.reasoning) {
							this.io.write(`${c.dim}[redacted]${c.reset}`);
							this.inlineStreamHasOutput = true;
							break;
						}
						this.io.write(`${c.dim}${event.reasoning ?? ""}${c.reset}`);
						this.inlineStreamHasOutput = true;
						break;
					case "tool": {
						this.closeInlineStreamIfNeeded();
						const toolName = event.toolName ?? "unknown_tool";
						const inputStr = formatToolInput(toolName, event.input);
						if (toolName === "ask_question") {
							break;
						}
						this.io.write(
							`${c.cyan}[${toolName}]${c.reset}${inputStr ? ` ${inputStr}` : ""}\n`,
						);
						break;
					}
				}
				break;

			case "content_end":
				switch (event.contentType) {
					case "text":
					case "reasoning":
						this.closeInlineStreamIfNeeded();
						break;
					case "tool":
						this.closeInlineStreamIfNeeded();
						if (event.toolName === "ask_question") {
							break;
						}
						if (event.error) {
							this.io.write(
								`   ${c.gray}${HOOK}${c.reset}${c.red}error: ${event.error}${c.reset}\n`,
							);
						} else {
							const outputStr = formatToolOutput(event.output);
							if (outputStr) {
								const lines = formatResultLines(outputStr);
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
						}
						this.shouldPrefixNextTextWithBlankLine = false;
						break;
					case "media": {
						this.closeInlineStreamIfNeeded();
						const media = event.media;
						if (!media) break;
						const saved = materializeGeneratedMedia(media);
						if (saved) {
							this.io.write(
								`${c.dim}[generated ${media.modality}]${c.reset} ${saved.path}\n`,
							);
						} else if (media.source.type === "url") {
							this.io.write(
								`${c.dim}[generated ${media.modality}]${c.reset} ${media.source.url}\n`,
							);
						} else if (media.source.type === "artifact") {
							this.io.write(
								`${c.dim}[generated ${media.modality}]${c.reset} artifact:${media.source.artifactId}\n`,
							);
						} else {
							this.io.write(
								`${c.dim}[generated ${media.modality}]${c.reset} ${media.mediaType} could not be saved\n`,
							);
						}
						break;
					}
				}
				break;

			case "done": {
				this.closeInlineStreamIfNeeded();
				if (this.config.verbose) {
					const iterations = event.iterations;
					const label = event.reason === "aborted" ? "aborted" : "finished";
					this.io.write(
						`\n${c.dim}── ${label} (${iterations} iterations) ──${c.reset}\n`,
					);
				}
				this.activeInlineStream = undefined;
				this.inlineStreamHasOutput = false;
				this.shouldPrefixNextTextWithBlankLine = false;
				break;
			}
			case "error":
				this.closeInlineStreamIfNeeded();
				if (!event.recoverable || this.config.verbose) {
					this.io.writeErr(
						formatCliErrorMessage(event.error, {
							modelId: this.config.modelId,
						}),
					);
				}
				break;
			case "notice":
				if (event.displayRole === "status") {
					this.closeInlineStreamIfNeeded();
					const label = this.statusLabel(event);
					if (label) {
						this.io.write(`\n${c.dim}[status]${c.reset} ${label}\n`);
					}
				}
				break;
		}
	}

	private statusLabel(event: AgentEvent): string | undefined {
		if (event.type !== "notice" || event.displayRole !== "status") {
			return undefined;
		}
		const compaction = parseCompactionNoticeMetadata(event.metadata);
		if (compaction) {
			return formatCompactionDividerLabel({ kind: "compaction", ...compaction });
		}
		switch (event.reason) {
			case "auto_compaction":
				return "auto-compacting";
			case "manual_compaction":
				return "compacting";
			case "compaction_budget_emergency":
				return "context budget adjusted";
		}
		return event.message.trim() || undefined;
	}
}
