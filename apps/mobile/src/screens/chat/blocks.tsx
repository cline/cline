/**
 * The per-block renderers for one chat turn (DESIGN_SPEC §4): user bubble,
 * assistant markdown, the collapsible reasoning left-rail, and the tool-activity
 * card with its state colors, diff counts and expandable code preview.
 *
 * Both collapsibles go through the shared `Disclosure` primitive, so the trigger
 * geometry (28px row, 8px gap, chevron rotating 180°) and the expand/collapse
 * accessibility contract are defined once for the whole app.
 */

import { Brain } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { userErrorMessage } from "@/error-message";
import type { MessageBlock, SessionMessageView } from "@/session";
import { withAlpha } from "@/theme/brand";
import {
	Banner,
	Chip,
	CodeBlock,
	Disclosure,
	Spinner,
	Text,
	useTheme,
} from "@/ui";
import { parseToolDiff } from "./diff";
import { GeneratedMediaBlock } from "./GeneratedMediaBlock";
import { Markdown } from "./Markdown";
import { extractToolOutputMedia, redactToolOutputMedia } from "./media";
import { messageDisplayText } from "./message-text";
import { useRememberedFlag } from "./reasoning-state";
import { ToolDiffView } from "./ToolDiffView";
import { diffCounts, toolIcon, toolLabel, toolPreview } from "./tools";
import { parseUserInputEnvelope, userInputModeLabel } from "./user-text";

export function UserMessageBubble({
	message,
}: {
	message: SessionMessageView;
}) {
	const theme = useTheme();
	// The hub persists user turns inside a `<user_input mode="...">` envelope; the
	// bubble shows the human text and promotes the mode to a chip (see user-text.ts).
	const { mode } = parseUserInputEnvelope(plainText(message));
	const text = messageDisplayText(message);
	const media = message.blocks.filter((block) => block.kind === "media");
	return (
		<View style={{ alignItems: "flex-end", gap: 4 }}>
			{media.length > 0 ? (
				<View style={{ width: "85%", gap: 6 }}>
					{media.map((block) => (
						<GeneratedMediaBlock
							key={`${message.id}-${block.media.id}`}
							media={block.media}
						/>
					))}
				</View>
			) : null}
			{text ? (
				<View
					style={{
						maxWidth: "85%",
						backgroundColor: theme.color.surfaceRaised,
						borderWidth: 1,
						borderColor: theme.color.border,
						borderRadius: theme.radius.md,
						paddingHorizontal: 10,
						paddingVertical: 8,
					}}
				>
					<Text variant="body">{text}</Text>
				</View>
			) : null}
			{mode ? (
				// A static Chip drops `accessibilityLabel`, so the spoken phrasing lives
				// on the wrapper: "Act" alone is meaningless out of context.
				<View accessible accessibilityLabel={`Sent in ${mode} mode`}>
					<Chip label={userInputModeLabel(mode)} tone="outline" pill />
				</View>
			) : null}
		</View>
	);
}

export function AssistantMessage({ message }: { message: SessionMessageView }) {
	if (message.displayRole === "error") {
		return (
			<Banner tone="danger">
				<Text variant="small" tone="danger" accessibilityRole="alert">
					{userErrorMessage(
						plainText(message),
						"Cline couldn't finish this turn. Try again.",
					)}
				</Text>
			</Banner>
		);
	}
	const groups = groupBlocks(message.blocks);
	return (
		<View style={{ gap: 8 }}>
			{groups.map((group, index) => {
				// Blocks are append-only and carry no id, so position *is* the identity —
				// which also makes it the key the reasoning collapse state is remembered under.
				const blockKey = `${message.id}-${index}`;
				if (group.kind === "reasoning-group") {
					const visible = group.blocks.filter((block) => !block.redacted);
					return (
						<ReasoningBlock
							key={blockKey}
							blockKey={blockKey}
							text={visible
								.map((block) => block.text)
								.filter(Boolean)
								.join("\n\n")}
							redacted={visible.length === 0}
							startedAt={
								group.blocks.find((block) => block.startedAt !== undefined)
									?.startedAt
							}
							completedAt={
								group.blocks.findLast(
									(block) => block.completedAt !== undefined,
								)?.completedAt
							}
						/>
					);
				}
				return (
					<BlockView key={blockKey} blockKey={blockKey} block={group.block} />
				);
			})}
		</View>
	);
}

type ReasoningMessageBlock = Extract<MessageBlock, { kind: "reasoning" }>;
type BlockGroup =
	| { kind: "reasoning-group"; blocks: ReasoningMessageBlock[] }
	| { kind: "block"; block: Exclude<MessageBlock, ReasoningMessageBlock> };

/** Consecutive thought fragments are one disclosure, matching Cline. */
export function groupBlocks(blocks: readonly MessageBlock[]): BlockGroup[] {
	const groups: BlockGroup[] = [];
	for (const block of blocks) {
		if (block.kind !== "reasoning") {
			groups.push({ kind: "block", block });
			continue;
		}
		const previous = groups.at(-1);
		if (previous?.kind === "reasoning-group") {
			previous.blocks.push(block);
		} else {
			groups.push({ kind: "reasoning-group", blocks: [block] });
		}
	}
	return groups;
}

function BlockView({
	block,
	blockKey,
}: {
	block: MessageBlock;
	blockKey: string;
}) {
	switch (block.kind) {
		case "text":
			return block.text.trim() ? <Markdown text={block.text} /> : null;
		case "reasoning":
			return (
				<ReasoningBlock
					blockKey={blockKey}
					text={block.text}
					redacted={block.redacted}
				/>
			);
		case "tool":
			return <ToolActivityCard block={block} blockKey={blockKey} />;
		case "media":
			return <GeneratedMediaBlock media={block.media} />;
	}
}

/**
 * Lines shown before a long thought is clamped. The spec caps the expanded rail
 * at ~192px of scroll; on a phone a clamp plus "Show more" beats a nested
 * scroll region inside an already-scrolling transcript.
 */
const REASONING_CLAMP_LINES = 8;
/** Roughly the clamp height in characters — cheap, and avoids measuring text. */
const REASONING_CLAMP_CHARS = 480;

function ReasoningBlock({
	blockKey,
	text,
	redacted,
	startedAt,
	completedAt,
}: {
	blockKey: string;
	text: string;
	redacted: boolean;
	startedAt?: number;
	completedAt?: number;
}) {
	const theme = useTheme();
	const label = redacted
		? "Redacted reasoning"
		: formatThoughtLabel(startedAt, completedAt);
	// One grouped disclosure is now meaningful, so the thought can stay out of the
	// way until someone chooses to inspect it — desktop's transcript behavior.
	const [expanded, setExpanded] = useRememberedFlag(blockKey, false);
	const [showAll, setShowAll] = useRememberedFlag(`${blockKey}#full`, false);

	const clampable =
		!redacted &&
		(text.length > REASONING_CLAMP_CHARS ||
			countLines(text) > REASONING_CLAMP_LINES);

	return (
		<Disclosure
			label={label}
			// Desktop's trigger sits at `text@70%` and brightens when open; a static
			// 70% is the restrained RN read of that.
			labelColor={withAlpha(theme.color.text, 0.7)}
			leading={<Brain size={16} color={theme.color.textMuted} />}
			variant="rail"
			expanded={expanded}
			onToggle={setExpanded}
			style={{ marginVertical: 4 }}
		>
			{redacted ? null : (
				<View style={{ gap: 4 }}>
					<Text
						variant="body"
						tone="muted"
						// 1.625 line-height per spec — reasoning is prose, not code.
						style={{ lineHeight: 23, opacity: 0.85 }}
						{...(clampable && !showAll
							? { numberOfLines: REASONING_CLAMP_LINES }
							: {})}
					>
						{text || "…"}
					</Text>
					{clampable ? (
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={
								showAll ? "Show less reasoning" : "Show more reasoning"
							}
							accessibilityState={{ expanded: showAll }}
							hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
							onPress={() => setShowAll(!showAll)}
						>
							<Text variant="small" tone="accent">
								{showAll ? "Show less" : "Show more"}
							</Text>
						</Pressable>
					) : null}
				</View>
			)}
		</Disclosure>
	);
}

export function formatThoughtLabel(
	startedAt?: number,
	completedAt?: number,
): string {
	if (
		startedAt === undefined ||
		completedAt === undefined ||
		!Number.isFinite(startedAt) ||
		!Number.isFinite(completedAt) ||
		completedAt < startedAt
	) {
		return "Thinking";
	}
	const elapsed = completedAt - startedAt;
	const seconds = elapsed === 0 ? 0 : Math.max(1, Math.round(elapsed / 1_000));
	return `Thought for ${seconds}s`;
}

function countLines(text: string): number {
	let lines = 1;
	for (let index = 0; index < text.length; index += 1) {
		if (text[index] === "\n") {
			lines += 1;
		}
	}
	return lines;
}

function ToolActivityCard({
	block,
	blockKey,
}: {
	blockKey: string;
	block: Extract<MessageBlock, { kind: "tool" }>;
}) {
	const theme = useTheme();
	const Icon = toolIcon(block.name);
	const counts =
		block.state === "completed"
			? diffCounts(block.name, block.input, block.output)
			: undefined;
	const outputMedia = extractToolOutputMedia(block.output);
	const preview = toolPreview(block.input, redactToolOutputMedia(block.output));
	const label = toolLabel(block.name, block.state, block.input);
	const files = parseToolDiff(block.name, block.input, block.output);
	const hasFileDiff = files.length > 0;
	const choiceKey = `tool:${blockKey}:${block.toolCallId ?? "anonymous"}`;
	const [userToggled, setUserToggled] = useRememberedFlag(
		`${choiceKey}:toggled`,
		false,
	);
	const [manualExpanded, setManualExpanded] = useRememberedFlag(
		`${choiceKey}:expanded`,
		false,
	);
	// Successful work recedes automatically. Active diffs and failures remain
	// visible; explicit choices survive completion and virtualized row remounts.
	const expanded = userToggled
		? manualExpanded
		: block.state === "failed" || (block.state === "running" && hasFileDiff);

	// Accent means alive now. Finished work recedes so a long transcript scans.
	const triggerColor =
		block.state === "failed" ? theme.color.danger : theme.color.textMuted;

	return (
		<Disclosure
			label={label}
			labelColor={triggerColor}
			accessibilityLabel={`Tool ${label}`}
			leading={
				block.state === "running" ? (
					<Spinner size={14} color={theme.color.textMuted} />
				) : (
					<Icon size={16} color={triggerColor} />
				)
			}
			trailing={counts ? <DiffCounts counts={counts} /> : null}
			variant="inset"
			indent={32}
			showIndicator={false}
			expanded={expanded}
			onToggle={(next) => {
				setUserToggled(true);
				setManualExpanded(next);
			}}
			style={{ marginVertical: 4 }}
		>
			{files.length > 0 ? (
				<ToolDiffView files={files} state={block.state} />
			) : preview ? (
				<CodeBlock muted={block.state === "completed"}>{preview}</CodeBlock>
			) : null}
			{outputMedia.length > 0 ? (
				<View
					style={{ gap: 8, marginTop: preview || files.length > 0 ? 8 : 0 }}
				>
					{outputMedia.map((media) => (
						<GeneratedMediaBlock key={media.id} media={media} />
					))}
				</View>
			) : null}
			{block.error ? (
				<Text variant="small" tone="danger" style={{ marginTop: 4 }}>
					{userErrorMessage(block.error, "This tool could not finish.")}
				</Text>
			) : null}
		</Disclosure>
	);
}

/** `+N` in the additions green, `−N` in danger — mono, per DESIGN_SPEC §4. */
function DiffCounts({
	counts,
}: {
	counts: { additions: number; deletions: number };
}) {
	const theme = useTheme();
	return (
		<View style={{ flexDirection: "row", gap: 6 }}>
			{counts.additions > 0 ? (
				<Text variant="mono" color={theme.feedback.success.fg}>
					+{counts.additions}
				</Text>
			) : null}
			{counts.deletions > 0 ? (
				<Text variant="mono" tone="danger">
					−{counts.deletions}
				</Text>
			) : null}
		</View>
	);
}

export function plainText(message: SessionMessageView): string {
	return message.blocks
		.filter(
			(block): block is Extract<MessageBlock, { kind: "text" }> =>
				block.kind === "text",
		)
		.map((block) => block.text)
		.join("")
		.trim();
}
