/**
 * Conversion functions between protobuf and TypeScript types for prompts
 */

import type { PromptItem, PromptsCatalog, TeamPrompt, TeamPromptsCatalog } from "@/shared/prompts"
import type {
	PromptItem as ProtoPromptItem,
	PromptsCatalog as ProtoPromptsCatalog,
	TeamPrompt as ProtoTeamPrompt,
	TeamPromptsCatalog as ProtoTeamPromptsCatalog,
} from "@/shared/proto/cline/prompts"
import { PromptType as ProtoPromptType } from "@/shared/proto/cline/prompts"

/**
 * Converts proto PromptType enum to TypeScript string literal
 */
export function convertProtoPromptTypeToString(protoType: ProtoPromptType): "rule" | "workflow" {
	switch (protoType) {
		case ProtoPromptType.PROMPT_TYPE_RULE:
			return "rule"
		case ProtoPromptType.PROMPT_TYPE_WORKFLOW:
			return "workflow"
		case ProtoPromptType.PROMPT_TYPE_UNSPECIFIED:
		default:
			return "rule" // Default fallback
	}
}

/**
 * Converts TypeScript string literal to proto PromptType enum
 */
export function convertStringToProtoPromptType(type: "rule" | "workflow"): ProtoPromptType {
	switch (type) {
		case "rule":
			return ProtoPromptType.PROMPT_TYPE_RULE
		case "workflow":
			return ProtoPromptType.PROMPT_TYPE_WORKFLOW
		default:
			return ProtoPromptType.PROMPT_TYPE_UNSPECIFIED
	}
}

/**
 * Converts proto PromptItem to TypeScript PromptItem
 */
export function convertProtoPromptItem(protoItem: ProtoPromptItem): PromptItem {
	return {
		promptId: protoItem.promptId,
		githubUrl: protoItem.githubUrl,
		name: protoItem.name,
		author: protoItem.author,
		description: protoItem.description,
		category: protoItem.category,
		tags: protoItem.tags,
		type: convertProtoPromptTypeToString(protoItem.type),
		content: protoItem.content,
		version: protoItem.version,
		globs: protoItem.globs,
		createdAt: protoItem.createdAt,
		updatedAt: protoItem.updatedAt,
	}
}

/**
 * Converts proto PromptsCatalog to TypeScript PromptsCatalog
 */
export function convertProtoPromptsCatalog(protoCatalog: ProtoPromptsCatalog): PromptsCatalog {
	return {
		items: protoCatalog.items.map(convertProtoPromptItem),
		lastUpdated: protoCatalog.lastUpdated,
	}
}

/**
 * Converts proto TeamPrompt to TypeScript TeamPrompt
 */
export function convertProtoTeamPrompt(protoPrompt: ProtoTeamPrompt): TeamPrompt {
	return {
		id: protoPrompt.id,
		organizationId: protoPrompt.organizationId,
		name: protoPrompt.name,
		description: protoPrompt.description,
		content: protoPrompt.content,
		type: convertProtoPromptTypeToString(protoPrompt.type),
		category: protoPrompt.category,
		tags: protoPrompt.tags,
		author: protoPrompt.author,
		createdAt: protoPrompt.createdAt,
		updatedAt: protoPrompt.updatedAt,
		shared: protoPrompt.shared,
	}
}

/**
 * Converts proto TeamPromptsCatalog to TypeScript TeamPromptsCatalog
 */
export function convertProtoTeamPromptsCatalog(protoCatalog: ProtoTeamPromptsCatalog): TeamPromptsCatalog {
	return {
		items: protoCatalog.items.map(convertProtoTeamPrompt),
		organizationId: protoCatalog.organizationId,
	}
}
