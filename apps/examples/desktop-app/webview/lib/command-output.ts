export const MAX_LIVE_COMMAND_OUTPUT_CHARS = 48_000;

const COMMAND_OUTPUT_TRUNCATION_MARKER =
	"\u001b[0m[Earlier command output truncated]\n";

export function appendCappedCommandOutput(
	current: string,
	chunk: string,
): { output: string; truncated: boolean } {
	const combined = `${current}${chunk}`;
	if (combined.length <= MAX_LIVE_COMMAND_OUTPUT_CHARS) {
		return {
			output: combined,
			truncated: current.startsWith(COMMAND_OUTPUT_TRUNCATION_MARKER),
		};
	}
	const tailLength = Math.max(
		0,
		MAX_LIVE_COMMAND_OUTPUT_CHARS - COMMAND_OUTPUT_TRUNCATION_MARKER.length,
	);
	return {
		output: `${COMMAND_OUTPUT_TRUNCATION_MARKER}${combined.slice(-tailLength)}`,
		truncated: true,
	};
}
