import { AlertDialog } from "@cline/ui";

const TYPE_LABELS = {
	plugin: "plugin",
	skill: "skill",
	workflow: "workflow",
	mcp: "MCP server",
	connector: "connector",
} as const;

type CustomizationRemovalAction = "Delete" | "Disconnect" | "Uninstall";

function describeRemoval(
	type: keyof typeof TYPE_LABELS,
	action: CustomizationRemovalAction,
	name: string,
): string {
	const verb = action.toLowerCase();
	switch (type) {
		case "connector":
			return `This will ${verb} "${name}". You'll need to connect it again to use its tools.`;
		case "plugin":
			return `This will ${verb} "${name}" and remove the customizations it provides.`;
		case "mcp":
			return `This will ${verb} "${name}" and remove it from settings.`;
		default:
			return `This will ${verb} "${name}" and remove it from your customizations.`;
	}
}

/** Confirm removing a customization, in the verb that matches how it was added. */
export function CustomizationDeleteDialog({
	open,
	type,
	name,
	action = "Uninstall",
	busy,
	onClose,
	onConfirm,
}: {
	open: boolean;
	type: keyof typeof TYPE_LABELS;
	name: string;
	/** Uninstall what was installed, disconnect what was connected, delete what the user made. */
	action?: CustomizationRemovalAction;
	busy: boolean;
	onClose: () => void;
	onConfirm: () => void;
}) {
	return (
		<AlertDialog
			open={open}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
			title={`${action} ${TYPE_LABELS[type]}?`}
			description={describeRemoval(type, action, name)}
			confirmLabel={action}
			confirmTone="destructive"
			confirmDisabled={busy}
			onConfirm={() => {
				onConfirm();
				onClose();
			}}
			cancelDisabled={busy}
		/>
	);
}
