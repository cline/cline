/**
 * Environment facts recorded for a tool call and attached to its tool result
 * message as `metadata.toolEnvironment`. Readers that do not know the key
 * ignore it.
 */
export interface ToolEnvironmentFileFact {
	path: string;
	exists: boolean;
	sha256?: string;
	bytes?: number;
	/** Set when the file was larger than the hashing cap; only `bytes` is recorded. */
	skipped?: "too-large" | "not-a-file" | "unreadable";
}

export interface ToolEnvironmentCommandFact {
	command: string;
	/** Derived from the tool result: 0 on success, the reported code otherwise. */
	exitCode: number | null;
	signal?: string;
	/** The command could not be started or timed out; no exit code exists. */
	failed?: string;
}

export interface ToolEnvironmentFacts {
	version: 1;
	/** read_files: content of each file as it was on disk when read. */
	read?: ToolEnvironmentFileFact[];
	/** editor/apply_patch: each target file before the tool ran. */
	preImage?: ToolEnvironmentFileFact[];
	/** editor/apply_patch: each target file after the tool ran. */
	postImage?: ToolEnvironmentFileFact[];
	/** run_commands: where and with which environment the commands ran. */
	commands?: {
		cwd: string;
		/** Hash of the allowlisted env recorded in the session's recording header. */
		envSha256: string;
		results: ToolEnvironmentCommandFact[];
	};
}

export const TOOL_ENVIRONMENT_METADATA_KEY = "toolEnvironment";
