import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, type StyleProp, View, type ViewStyle } from "react-native";
import { withAlpha } from "@/theme/brand";
import { useTheme } from "../theme";
import { Button } from "./Button";
import { Text } from "./Text";

export interface CodeBlockProps {
	/** Pre-formatted text. Rendered verbatim in mono. */
	children: string;
	/** Scroll ceiling. Tool output 208, approval detail 176 (DESIGN_SPEC §4/§6). */
	maxHeight?: number;
	/** Dim the text to `textMuted` — for demoted diagnostics. */
	muted?: boolean;
	/** Wrap long lines instead of scrolling horizontally. */
	wrap?: boolean;
	style?: StyleProp<ViewStyle>;
	copyLabel?: string;
	/** Explicit conversation Find request; preserves the exact displayed/copied text. */
	revealText?: { query: string; sequence: number };
}

/**
 * Bordered mono panel for tool output, command previews and raw diagnostics —
 * desktop's `ToolActivityCode` (DESIGN_SPEC §4): `xs` mono at line-height
 * 1.625, 8px padding, `radius.sm`, hairline border at 70% and a `canvas@60%`
 * fill, capped in height and scrollable. Long lines scroll on a nested
 * horizontal `ScrollView` (the RN substitute for desktop's hidden-bar
 * horizontal overflow) unless `wrap` is set.
 */
export function CodeBlock({
	children,
	maxHeight = 208,
	muted = false,
	wrap = false,
	style,
	copyLabel,
	revealText,
}: CodeBlockProps) {
	const theme = useTheme();
	const vertical = useRef<ScrollView>(null);
	const horizontal = useRef<ScrollView>(null);
	const content = useRef({ width: 0, height: 0 });
	const revealedSequence = useRef<number | undefined>(undefined);
	const revealMatch = useCallback(() => {
		if (
			!revealText?.query ||
			revealedSequence.current === revealText.sequence ||
			content.current.height <= 0 ||
			(!wrap && content.current.width <= 0)
		)
			return;
		const offset = children
			.toLocaleLowerCase()
			.indexOf(revealText.query.toLocaleLowerCase());
		if (offset < 0) return;
		revealedSequence.current = revealText.sequence;
		const lines = children.split("\n");
		const before = children.slice(0, offset).split("\n");
		const line = before.length - 1;
		const column = before.at(-1)?.length ?? 0;
		vertical.current?.scrollTo({
			y: (line * content.current.height) / Math.max(1, lines.length),
			animated: false,
		});
		horizontal.current?.scrollTo({
			x:
				(column * content.current.width) /
				lines.reduce((max, value) => Math.max(max, value.length), 1),
			animated: false,
		});
	}, [children, revealText, wrap]);
	useEffect(revealMatch, [revealMatch]);
	const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
		"idle",
	);
	const body = (
		<Text
			variant="mono"
			selectable
			tone={muted ? "muted" : "default"}
			style={{ lineHeight: 20 }}
		>
			{children}
		</Text>
	);

	return (
		<View
			style={[
				{
					maxHeight,
					borderWidth: 1,
					borderColor: withAlpha(theme.color.border, theme.borderAlpha.medium),
					borderRadius: theme.radius.sm,
					backgroundColor: withAlpha(theme.color.canvas, 0.6),
					padding: 8,
				},
				style,
			]}
		>
			{copyLabel ? (
				<View style={{ alignItems: "flex-end", marginBottom: 4 }}>
					<Button
						label={copyLabel}
						accessibilityLabel={copyLabel}
						variant="ghost"
						size="sm"
						onPress={() => {
							void Clipboard.setStringAsync(children)
								.then(() => setCopyState("copied"))
								.catch(() => setCopyState("failed"));
						}}
					/>
					{copyState !== "idle" ? (
						<Text
							variant="caption"
							tone={copyState === "failed" ? "danger" : "muted"}
						>
							{copyState === "copied" ? "Copied" : "Couldn't copy. Try again."}
						</Text>
					) : null}
				</View>
			) : null}
			<ScrollView
				ref={vertical}
				onContentSizeChange={(_width, height) => {
					content.current.height = height;
					revealMatch();
				}}
			>
				{wrap ? (
					body
				) : (
					<ScrollView
						ref={horizontal}
						horizontal
						showsHorizontalScrollIndicator={false}
						onContentSizeChange={(width) => {
							content.current.width = width;
							revealMatch();
						}}
					>
						{body}
					</ScrollView>
				)}
			</ScrollView>
		</View>
	);
}
