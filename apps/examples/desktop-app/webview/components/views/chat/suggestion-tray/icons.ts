import type { PluginUiIcon } from "@cline/shared/browser";
import {
	ArrowRight,
	CheckCheck,
	CircleDot,
	ExternalLink,
	FileDiff,
	Flag,
	GitCommitHorizontal,
	GitPullRequest,
	Lightbulb,
	ListChecks,
	type LucideIcon,
	Megaphone,
	MessageCircle,
	MessageCircleQuestion,
	MessageSquareReply,
	Play,
	RotateCcw,
	Wrench,
} from "lucide-react";

/** Cline's icon meanings as lucide glyphs. */
const SUGGESTION_ICONS: Record<PluginUiIcon, LucideIcon> = {
	fix: Wrench,
	retry: RotateCcw,
	verify: CheckCheck,
	review: FileDiff,
	explain: Lightbulb,
	resume: Play,
	next: ArrowRight,
	plan: ListChecks,
	answer: MessageCircleQuestion,
	reply: MessageSquareReply,
	commit: GitCommitHorizontal,
	wrap_up: Flag,
	ci: GitPullRequest,
	issue: CircleDot,
	announce: Megaphone,
	link: ExternalLink,
};

/** A row without an icon still gets a tile glyph; the word beside it carries the meaning. */
export function suggestionIcon(icon: PluginUiIcon | undefined): LucideIcon {
	return icon ? SUGGESTION_ICONS[icon] : MessageCircle;
}
