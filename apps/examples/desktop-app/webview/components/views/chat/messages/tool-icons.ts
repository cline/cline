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
import { classifyTool, normalizeToolName } from "./tool-summaries";

export const TOOL_NAME_ICONS: Record<string, LucideIcon> = {
	apply_patch: PencilIcon,
	ask_question: MessageCircleQuestionMarkIcon,
	editor: PencilIcon,
	fetch_web_content: PanelsTopLeftIcon,
	mcp: BoxIcon,
	plugins: BlocksIcon,
	read_files: FilesIcon,
	run_commands: TerminalIcon,
	search_codebase: SearchCodeIcon,
	skills: LibraryIcon,
	spawn_agent: UserIcon,
	submit_and_exit: SquareArrowRightIcon,
};

export const TOOL_KIND_ICONS: Record<
	ReturnType<typeof classifyTool>,
	LucideIcon
> = {
	bash: TerminalIcon,
	exploration: SearchCodeIcon,
	"file-edit": PencilIcon,
	spawn: UserIcon,
	tool: WrenchIcon,
};

export function getToolNameIcon(toolName: string): LucideIcon {
	const normalized = normalizeToolName(toolName);
	if (normalized.startsWith("subagent_")) {
		return UserIcon;
	}
	if (
		normalized === "team" ||
		normalized === "teams" ||
		normalized.startsWith("team_")
	) {
		return UsersIcon;
	}
	return (
		TOOL_NAME_ICONS[normalized] ?? TOOL_KIND_ICONS[classifyTool(normalized)]
	);
}
