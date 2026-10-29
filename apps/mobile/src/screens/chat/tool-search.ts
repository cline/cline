import { userErrorMessage } from "@/error-message";
import type { MessageBlock } from "@/session";
import { parseToolDiff } from "./diff";
import { redactToolOutputMedia } from "./media";
import { toolLabel, toolPreview } from "./tools";

export interface ToolSearchReveal {
	sequence: number;
	query: string;
}

/** Search only text the tool card renders; never serialize the transport block. */
export function toolSearchText(
	block: Extract<MessageBlock, { kind: "tool" }>,
): string {
	const files = parseToolDiff(block.name, block.input, block.output);
	const firstFile = files[0];
	const preview = firstFile
		? [
				files.length === 1 ? firstFile.path.split(/[\\/]/).at(-1) : undefined,
				...firstFile.lines.slice(0, 4).map((line) => line.text),
			]
				.filter(Boolean)
				.join("\n")
		: toolPreview(block.input, redactToolOutputMedia(block.output));
	return [
		toolLabel(block.name, block.state, block.input, block.approvalStatus),
		preview,
		block.error
			? userErrorMessage(block.error, "This tool could not finish.")
			: undefined,
	]
		.filter(Boolean)
		.join("\n");
}
