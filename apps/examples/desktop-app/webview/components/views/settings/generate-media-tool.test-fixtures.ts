import { vi } from "vitest";
import type { Provider } from "@/lib/provider-schema";
import type {
	GenerateMediaToolConfig,
	MediaTypeConfiguration,
} from "./generate-media-tool";

/** Shared provider fixtures for generate_media configuration tests. */
export const eligibleProviders: Provider[] = [
	{
		id: "vercel-ai-gateway",
		name: "Vercel AI Gateway",
		models: 3,
		color: "#000000",
		letter: "VA",
		enabled: true,
		modelList: [
			{
				id: "imagen",
				name: "Imagen",
				operation: "image-generation",
				inputModalities: ["text"],
				outputModalities: ["image"],
			},
			{
				id: "mixed-image",
				name: "Mixed Image",
				operation: "language",
				inputModalities: ["text"],
				outputModalities: ["text", "image"],
			},
			{
				id: "chat-only",
				name: "Chat only",
				inputModalities: ["text"],
				outputModalities: ["text"],
			},
			{
				id: "audio-gen",
				name: "Audio Gen",
				operation: "speech-generation",
				inputModalities: ["text"],
				outputModalities: ["audio"],
			},
		],
	},
	{
		id: "custom-provider",
		name: "Custom provider",
		models: 1,
		color: "#111111",
		letter: "CP",
		enabled: true,
		modelList: [
			{
				id: "advertised-but-unsupported",
				name: "Advertised but unsupported",
				operation: "image-generation",
				inputModalities: ["text"],
				outputModalities: ["image"],
			},
		],
	},
	{
		id: "disabled-image-provider",
		name: "Disabled image provider",
		models: 1,
		color: "#222222",
		letter: "DI",
		enabled: false,
		modelList: [
			{
				id: "disabled-image",
				name: "Disabled image",
				operation: "image-generation",
				inputModalities: ["text"],
				outputModalities: ["image"],
			},
		],
	},
];

export const mediaGenerationModels = {
	audio: {},
	image: {
		"vercel-ai-gateway": ["imagen", "mixed-image"],
		"custom-provider": [],
		"disabled-image-provider": ["disabled-image"],
	},
	video: {},
};

export function generateMediaConfig(
	overrides: Partial<GenerateMediaToolConfig> = {},
): GenerateMediaToolConfig {
	return {
		error: null,
		loading: false,
		mediaTypes: [imageMediaConfiguration()],
		onChange: vi.fn(),
		onConfigureProviders: vi.fn(),
		providers: eligibleProviders,
		...overrides,
	};
}

export function imageMediaConfiguration(
	selection?: MediaTypeConfiguration["selection"],
): MediaTypeConfiguration {
	return {
		mediaType: "image",
		modelIdsByProvider: mediaGenerationModels.image,
		saving: false,
		selection,
	};
}
