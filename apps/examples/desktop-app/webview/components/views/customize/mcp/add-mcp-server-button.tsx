import { Button } from "@cline/ui";
import { Plus } from "lucide-react";

export function AddMcpServerButton({
	onCreateMcp,
}: {
	onCreateMcp?: (trigger?: HTMLButtonElement) => void;
}) {
	return (
		<Button
			type="button"
			size="sm"
			tone="neutral"
			leadingIcon={Plus}
			disabled={!onCreateMcp}
			onClick={(event) => onCreateMcp?.(event.currentTarget)}
		>
			Add MCP server
		</Button>
	);
}
