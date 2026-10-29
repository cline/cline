export type ArtifactFetcher = (input: {
	artifactId: string;
	signal?: AbortSignal;
}) => Promise<Response>;
