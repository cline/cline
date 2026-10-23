/**
 * The Cline quick-action group — the RN counterpart of `@cline/ui`'s
 * `AgentQuickActions` (`sdk/packages/ui/components/agent-quick-actions.{tsx,css}`),
 * the card the desktop welcome surface puts under its hero.
 *
 * Desktop geometry, reproduced exactly:
 *  - ONE container, not a stack of cards: `radius-xl` (12), `border@60%`,
 *    `background@95%`, `padding-inline: 0.5rem` (8), soft shadow;
 *  - each row `padding: 0.75rem` (12), label and description on the left,
 *    affordance hard right, `gap: 1.25rem` (20) between them;
 *  - a `border@80%` hairline between rows, none after the last;
 *  - label `0.9375rem` (15) at `--font-weight-medium`, description `--text-sm`
 *    (14/20) in `--muted-foreground`;
 *  - affordance: 28×28 (`1.75rem`), `radius-md`, `primary@10%` fill with a
 *    `primary` glyph — and on hover the fill goes SOLID `primary` with a
 *    `primary-foreground` glyph. Touch has no hover, so that inversion is bound
 *    to `Pressable`'s pressed state instead.
 *
 * Two deliberate departures, both because this is a phone and not a pointer:
 *  - the description is allowed to wrap instead of `white-space: nowrap` +
 *    ellipsis, since a 390pt viewport cannot fit a sentence on one line;
 *  - a row may carry `detail` content under its description (the `/handoff`
 *    command block), which desktop's single-line rows have no need for.
 */

import { ArrowRight } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { withAlpha } from "@/theme/brand";
import { channel } from "@/theme/surfaces";
import { Divider } from "../primitives/Divider";
import { Text } from "../primitives/Text";
import { fontWeight, useTheme } from "../theme";

/** Desktop `padding-inline: 0.5rem` on the group. */
const GROUP_INSET = 8;
/** Desktop row `padding: 0.75rem`. */
const ROW_PADDING = 12;
/** Desktop `gap: 1.25rem` between the copy and the affordance. */
const ROW_GAP = 20;
/** Desktop affordance box `1.75rem`. */
const AFFORDANCE = 28;
/** Desktop label step: `0.9375rem`, between `text-sm` (14) and `text-base` (16). */
const LABEL_SIZE = 15;

export interface QuickActionProps {
	/** The action, in the imperative ("Sign in to Cline"). */
	label: string;
	/** One line saying what it does. Wraps rather than truncating on a phone. */
	description?: string;
	/**
	 * Extra content under the description — a command block, a code, a hint.
	 * Rendered inside the row so a screen reader reaches it in reading order.
	 */
	detail?: ReactNode;
	/** Glyph in the right-hand affordance. Defaults to a right arrow. */
	icon?: ReactNode;
	/** Omit to render an informational row: no affordance, no button role. */
	onPress?: () => void;
	disabled?: boolean;
	/** Spoken name. Defaults to `label`. */
	accessibilityLabel?: string;
	/** Spoken consequence, e.g. "Opens your browser to finish signing in". */
	accessibilityHint?: string;
}

/**
 * One row of a {@link QuickActions} group. Exported for typing; render it as a
 * child of `QuickActions` so it inherits the group's dividers and inset.
 */
export function QuickAction({
	label,
	description,
	detail,
	icon,
	onPress,
	disabled = false,
	accessibilityLabel,
	accessibilityHint,
}: QuickActionProps) {
	const theme = useTheme();
	const interactive = onPress != null && !disabled;

	const copy = (pressed: boolean) => (
		<>
			<View style={{ flex: 1, minWidth: 0, gap: 2 }}>
				<Text
					variant="body"
					weight={fontWeight.medium}
					style={{ fontSize: LABEL_SIZE, lineHeight: 22 }}
				>
					{label}
				</Text>
				{description ? (
					<Text variant="body" tone="muted">
						{description}
					</Text>
				) : null}
				{detail ? <View style={{ marginTop: 8 }}>{detail}</View> : null}
			</View>

			{interactive ? (
				<View
					style={{
						width: AFFORDANCE,
						height: AFFORDANCE,
						alignItems: "center",
						justifyContent: "center",
						borderRadius: theme.radius.md,
						backgroundColor: pressed
							? theme.brand.violet
							: theme.brand.violetSubtle,
					}}
				>
					{icon ?? (
						<ArrowRight
							size={14}
							color={pressed ? theme.brand.onViolet : theme.brand.violet}
						/>
					)}
				</View>
			) : null}
		</>
	);

	const layout = {
		flexDirection: "row" as const,
		alignItems: "flex-start" as const,
		gap: ROW_GAP,
		padding: ROW_PADDING,
		// Desktop rows are single-line; a wrapped phone row still owes 44pt.
		minHeight: 44,
	};

	if (!interactive) {
		return <View style={layout}>{copy(false)}</View>;
	}

	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={accessibilityLabel ?? label}
			{...(accessibilityHint ? { accessibilityHint } : {})}
			accessibilityState={{ disabled }}
			disabled={disabled}
			onPress={onPress}
			style={({ pressed }) => [
				layout,
				{
					borderRadius: theme.radius.md,
					// Desktop hover lifts the row toward `background@55%`.
					backgroundColor: pressed
						? withAlpha(theme.color.canvas, 0.55)
						: channel.maskClear,
					opacity: disabled ? 0.5 : 1,
				},
			]}
		>
			{({ pressed }) => copy(pressed)}
		</Pressable>
	);
}

export interface QuickActionsProps {
	/** {@link QuickAction} rows. Hairlines are drawn between them, not after. */
	children: ReactNode;
	/** Group label for assistive tech, e.g. "Ways to get a session". */
	accessibilityLabel?: string;
}

/**
 * The bordered group the rows live in. Presence comes from the hairline and a
 * faint shadow, not elevation — desktop's cards are near-flat.
 */
export function QuickActions({
	children,
	accessibilityLabel,
}: QuickActionsProps) {
	const theme = useTheme();
	const rows = flattenRows(children);

	return (
		<View
			{...(accessibilityLabel
				? { accessibilityRole: "menu" as const, accessibilityLabel }
				: {})}
			style={{
				width: "100%",
				overflow: "hidden",
				paddingHorizontal: GROUP_INSET,
				borderWidth: 1,
				borderColor: withAlpha(theme.color.border, theme.borderAlpha.soft),
				borderRadius: theme.radius.lg,
				backgroundColor: withAlpha(theme.color.surfaceRaised, 0.95),
				shadowColor: channel.shadow,
				shadowOffset: { width: 0, height: 1 },
				shadowOpacity: 0.1,
				shadowRadius: 3,
				elevation: 1,
			}}
		>
			{rows.map((row, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: rows are a static, ordered literal list
				<View key={index}>
					{index > 0 ? <Divider alpha={theme.borderAlpha.strong} /> : null}
					{row}
				</View>
			))}
		</View>
	);
}

/** Flatten `children` to a row list, dropping the `null`s conditionals leave. */
function flattenRows(children: ReactNode): ReactNode[] {
	const out: ReactNode[] = [];
	const visit = (node: ReactNode) => {
		if (node == null || node === false || node === true) {
			return;
		}
		if (Array.isArray(node)) {
			for (const child of node) {
				visit(child as ReactNode);
			}
			return;
		}
		out.push(node);
	};
	visit(children);
	return out;
}
