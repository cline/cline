import * as Clipboard from "expo-clipboard";
import { Check, Copy } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, type StyleProp, View, type ViewStyle } from "react-native";
import { withAlpha } from "@/theme/brand";
import { useTheme } from "../theme";
import { IconButton } from "./IconButton";
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
 * horizontal `ScrollView` unless `wrap` is set.
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
	const viewport = useRef({ width: 0, height: 0 });
	const revealedSequence = useRef<number | undefined>(undefined);
	const revealMatch = useCallback(() => {
		if (
			!revealText?.query ||
			revealedSequence.current === revealText.sequence ||
			content.current.height <= 0 ||
			viewport.current.height <= 0 ||
			viewport.current.width <= 0 ||
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
		const lineHeight = content.current.height / Math.max(1, lines.length);
		const characterWidth =
			content.current.width /
			lines.reduce((max, value) => Math.max(max, value.length), 1);
		vertical.current?.scrollTo({
			y:
				(line + 1) * lineHeight <= viewport.current.height
					? 0
					: Math.max(
							0,
							Math.min(
								line * lineHeight,
								content.current.height - viewport.current.height,
							),
						),
			animated: false,
		});
		horizontal.current?.scrollTo({
			x:
				(column + revealText.query.length) * characterWidth <=
				viewport.current.width
					? 0
					: Math.max(
							0,
							Math.min(
								column * characterWidth - 16,
								content.current.width - viewport.current.width,
							),
						),
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
				<View
					style={{
						flexDirection: "row",
						justifyContent: "flex-end",
						alignItems: "center",
						gap: 4,
					}}
				>
					{copyState !== "idle" ? (
						<Text
							variant="caption"
							tone={copyState === "failed" ? "danger" : "muted"}
							accessibilityLiveRegion="polite"
						>
							{copyState === "copied" ? "Copied" : "Couldn't copy. Try again."}
						</Text>
					) : null}
					<IconButton
						accessibilityLabel={copyLabel}
						onPress={() => {
							void Clipboard.setStringAsync(children)
								.then(() => setCopyState("copied"))
								.catch(() => setCopyState("failed"));
						}}
					>
						{copyState === "copied" ? (
							<Check size={16} color={theme.color.textMuted} />
						) : (
							<Copy size={16} color={theme.color.textMuted} />
						)}
					</IconButton>
				</View>
			) : null}
			<ScrollView
				ref={vertical}
				style={{ flexGrow: 0, flexShrink: 1 }}
				contentInsetAdjustmentBehavior="never"
				automaticallyAdjustContentInsets={false}
				onLayout={({ nativeEvent: { layout } }) => {
					viewport.current = { width: layout.width, height: layout.height };
					revealMatch();
				}}
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
						style={{ flexGrow: 0 }}
						contentInsetAdjustmentBehavior="never"
						automaticallyAdjustContentInsets={false}
						showsHorizontalScrollIndicator
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
