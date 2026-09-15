import {
	classifyTool,
	normalizeToolName,
	type ToolKind,
} from "@cline/ui/components/agent-chat/tool-summary";
import {
	BlocksIcon,
	BoxIcon,
	FilesIcon,
	LibraryIcon,
	type LucideIcon,
	MessageCircleQuestionMarkIcon,
	PanelsTopLeftIcon,
	PencilIcon,
	SearchCodeIcon,
	SquareArrowRightIcon,
	TerminalIcon,
	UserIcon,
	UsersIcon,
	WrenchIcon,
} from "lucide-react";

// Overrides for tools whose kind-based icon would be misleading.
export const TOOL_NAME_ICONS: Record<string, LucideIcon> = {
	plugins: BlocksIcon,
	submit_and_exit: SquareArrowRightIcon,
};

export const TOOL_KIND_ICONS: Record<ToolKind, LucideIcon> = {
	command: TerminalIcon,
	edit: PencilIcon,
	mcp: BoxIcon,
	other: WrenchIcon,
	question: MessageCircleQuestionMarkIcon,
	read: FilesIcon,
	search: SearchCodeIcon,
	skill: LibraryIcon,
	spawn: UserIcon,
	team: UsersIcon,
	web: PanelsTopLeftIcon,
};

export function getToolNameIcon(toolName: string): LucideIcon {
	const normalized = normalizeToolName(toolName);
	return (
		TOOL_NAME_ICONS[normalized] ?? TOOL_KIND_ICONS[classifyTool(normalized)]
	);
}
