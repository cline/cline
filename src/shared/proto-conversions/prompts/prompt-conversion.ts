import { CustomPromptMetadata, SystemPrompt } from "@core/prompts/SystemPromptsManager"
import * as proto from "@shared/proto/index"

/**
 * Converts a CustomPromptMetadata to a protobuf PromptMetadata message.
 */
export function metadataToProto(metadata: CustomPromptMetadata | undefined): proto.cline.PromptMetadata | undefined {
	if (!metadata) {
		return undefined
	}

	return proto.cline.PromptMetadata.create({
		name: metadata.name,
		description: metadata.description,
		version: metadata.version,
		author: metadata.author,
		tools: metadata.tools
			? proto.cline.ToolConfiguration.create({
					enabled: metadata.tools.enabled || [],
					disabled: metadata.tools.disabled || [],
				})
			: undefined,
		includeToolInstructions: metadata.includeToolInstructions,
		includeEditingGuidelines: metadata.includeEditingGuidelines,
		includeBrowserRules: metadata.includeBrowserRules,
		includeMcpSection: metadata.includeMcpSection,
		includeUserInstructions: metadata.includeUserInstructions,
		includeRules: metadata.includeRules,
		includeSystemInfo: metadata.includeSystemInfo,
	})
}

/**
 * Converts a SystemPrompt to a protobuf SystemPromptInfo message.
 */
export function promptInfoToProto(prompt: SystemPrompt): proto.cline.SystemPromptInfo {
	return proto.cline.SystemPromptInfo.create({
		id: prompt.id,
		filename: prompt.filename,
		name: prompt.name,
		description: prompt.description || "",
		enabled: prompt.enabled,
		filepath: prompt.filepath,
		metadata: metadataToProto(prompt.metadata),
	})
}

/**
 * Converts a protobuf PromptMetadata to CustomPromptMetadata.
 */
export function protoToMetadata(protoMetadata: proto.cline.PromptMetadata | null | undefined): Partial<CustomPromptMetadata> {
	if (!protoMetadata) {
		return {}
	}

	const metadata: Partial<CustomPromptMetadata> = {}

	if (protoMetadata.version) metadata.version = protoMetadata.version
	if (protoMetadata.author) metadata.author = protoMetadata.author

	if (protoMetadata.tools) {
		metadata.tools = {
			enabled: protoMetadata.tools.enabled || [],
			disabled: protoMetadata.tools.disabled || [],
		}
	}

	if (protoMetadata.includeToolInstructions !== undefined) {
		metadata.includeToolInstructions = protoMetadata.includeToolInstructions
	}
	if (protoMetadata.includeEditingGuidelines !== undefined) {
		metadata.includeEditingGuidelines = protoMetadata.includeEditingGuidelines
	}
	if (protoMetadata.includeBrowserRules !== undefined) {
		metadata.includeBrowserRules = protoMetadata.includeBrowserRules
	}
	if (protoMetadata.includeMcpSection !== undefined) {
		metadata.includeMcpSection = protoMetadata.includeMcpSection
	}
	if (protoMetadata.includeUserInstructions !== undefined) {
		metadata.includeUserInstructions = protoMetadata.includeUserInstructions
	}
	if (protoMetadata.includeRules !== undefined) {
		metadata.includeRules = protoMetadata.includeRules
	}
	if (protoMetadata.includeSystemInfo !== undefined) {
		metadata.includeSystemInfo = protoMetadata.includeSystemInfo
	}

	return metadata
}
