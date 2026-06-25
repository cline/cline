export type { FastFileIndexOptions } from "./file-indexer";
export { getFileIndex, prewarmFileIndex } from "./file-indexer";
export type {
	MentionEnricherOptions,
	MentionEnrichmentResult,
} from "./mention-enricher";
export { enrichPromptWithMentions } from "./mention-enricher";
