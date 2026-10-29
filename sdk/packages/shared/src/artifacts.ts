import type { GeneratedMediaSource } from "./llms/media";

export type ArtifactReference = Extract<
	GeneratedMediaSource,
	{ type: "artifact" }
>;

export type ArtifactResource = {
	url: string;
	expiresAt?: string;
};

export type ArtifactResolver = (
	reference: ArtifactReference,
) => Promise<ArtifactResource>;
