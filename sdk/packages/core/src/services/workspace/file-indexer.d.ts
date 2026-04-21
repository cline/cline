export interface FastFileIndexOptions {
	ttlMs?: number;
}
export declare function getFileIndex(
	cwd: string,
	options?: FastFileIndexOptions,
): Promise<Set<string>>;
export declare function prewarmFileIndex(
	cwd: string,
	options?: FastFileIndexOptions,
): Promise<void>;
