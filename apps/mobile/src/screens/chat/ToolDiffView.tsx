import { FileCode2, X } from "lucide-react-native";
import { useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { withAlpha } from "@/theme/brand";
import { Button, Text, useTheme } from "@/ui";
import { type MobileDiffLine, type MobileFileDiff } from "./diff";

export function ToolDiffView({
	files,
	state = "completed",
}: {
	files: readonly MobileFileDiff[];
	state?: "running" | "completed" | "failed";
}) {
	const theme = useTheme();
	const insets = useSafeAreaInsets();
	const reducedMotion = useReducedMotion();
	const [open, setOpen] = useState(false);
	const totals = files.reduce(
		(sum, file) => ({
			additions: sum.additions + file.additions,
			deletions: sum.deletions + file.deletions,
		}),
		{ additions: 0, deletions: 0 },
	);
	const summary = `${files.length} ${files.length === 1 ? "file" : "files"}, ${totals.additions} additions, ${totals.deletions} deletions`;
	const applied = state === "completed";
	const actionLabel = applied
		? "Review diff"
		: state === "failed"
			? "Review attempted diff"
			: "Review proposed diff";

	return (
		<>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`${actionLabel}, ${summary}`}
				onPress={() => setOpen(true)}
				style={({ pressed }) => ({
					gap: 8,
					padding: 10,
					borderWidth: 1,
					borderColor: pressed ? theme.brand.violet : theme.color.border,
					borderRadius: theme.radius.sm,
					backgroundColor: pressed
						? theme.color.surfaceHover
						: theme.color.canvas,
				})}
			>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
					<FileCode2 size={15} color={theme.color.textMuted} />
					<Text
						variant="small"
						weight="500"
						style={{ flex: 1 }}
						numberOfLines={1}
					>
						{files.length === 1
							? displayPath(files[0]?.path ?? "File")
							: `${files.length} files ${applied ? "changed" : "in proposal"}`}
					</Text>
					<DiffTotals
						additions={totals.additions}
						deletions={totals.deletions}
					/>
				</View>
				{files[0]?.lines.slice(0, 4).map((line, index) => (
					<DiffLine key={`${line.kind}-${index}`} line={line} compact />
				))}
				<Text variant="caption" tone="accent">
					{actionLabel}
				</Text>
			</Pressable>

			<Modal
				supportedOrientations={[
					"portrait",
					"portrait-upside-down",
					"landscape",
				]}
				visible={open}
				animationType={reducedMotion ? "none" : "slide"}
				presentationStyle="fullScreen"
				onRequestClose={() => setOpen(false)}
			>
				<View
					style={{
						flex: 1,
						paddingTop: insets.top,
						paddingLeft: insets.left,
						paddingRight: insets.right,
						backgroundColor: theme.color.canvas,
					}}
				>
					<View
						style={{
							minHeight: 52,
							paddingHorizontal: 16,
							flexDirection: "row",
							alignItems: "center",
							gap: 10,
							borderBottomWidth: 1,
							borderBottomColor: theme.color.border,
						}}
					>
						<View style={{ flex: 1 }}>
							<Text variant="body" weight="600">
								{applied ? "Changes" : "Attempted changes"}
							</Text>
							<Text variant="caption" tone="muted">
								{summary}
							</Text>
						</View>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel="Close diff"
							hitSlop={10}
							onPress={() => setOpen(false)}
							style={({ pressed }) => ({
								opacity: pressed ? 0.6 : 1,
								padding: 8,
							})}
						>
							<X size={20} color={theme.color.text} />
						</Pressable>
					</View>
					{open ? (
						<DiffPages files={files} bottomInset={insets.bottom} />
					) : null}
				</View>
			</Modal>
		</>
	);
}

const DIFF_LINES_PER_PAGE = 200;

/** Keep mounted text bounded while making every received file and line reachable. */
function DiffPages({
	files,
	bottomInset,
}: {
	files: readonly MobileFileDiff[];
	bottomInset: number;
}) {
	const theme = useTheme();
	const [selectedFile, setSelectedFile] = useState(0);
	const [selectedPage, setSelectedPage] = useState(0);
	const fileIndex = Math.min(selectedFile, Math.max(0, files.length - 1));
	const file = files[fileIndex];
	if (!file)
		return (
			<Text tone="muted" style={{ padding: 16 }}>
				No diff content available.
			</Text>
		);
	const pageCount = Math.max(
		1,
		Math.ceil(file.lines.length / DIFF_LINES_PER_PAGE),
	);
	const page = Math.min(selectedPage, pageCount - 1);
	const start = page * DIFF_LINES_PER_PAGE;
	const lines = file.lines.slice(start, start + DIFF_LINES_PER_PAGE);
	const changeFile = (index: number) => {
		setSelectedFile(index);
		setSelectedPage(0);
	};
	return (
		<ScrollView
			key={`${fileIndex}:${page}`}
			contentContainerStyle={{
				padding: 12,
				paddingBottom: bottomInset + 20,
				gap: 12,
			}}
		>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
					flexWrap: "wrap",
					gap: 8,
				}}
			>
				<Button
					label="Previous file"
					variant="ghost"
					disabled={fileIndex === 0}
					onPress={() => changeFile(fileIndex - 1)}
				/>
				<Text variant="caption" tone="muted">
					{fileIndex + 1} / {files.length}
				</Text>
				<Button
					label="Next file"
					variant="ghost"
					disabled={fileIndex === files.length - 1}
					onPress={() => changeFile(fileIndex + 1)}
				/>
			</View>
			<Text variant="mono" weight="600" selectable>
				{file.path}
			</Text>
			<DiffTotals additions={file.additions} deletions={file.deletions} />
			{pageCount > 1 ? (
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						justifyContent: "space-between",
						flexWrap: "wrap",
						gap: 8,
					}}
				>
					<Button
						label="Previous lines"
						variant="ghost"
						disabled={page === 0}
						onPress={() => setSelectedPage(page - 1)}
					/>
					<Text variant="caption" tone="muted">
						{start + 1}–{start + lines.length} / {file.lines.length}
					</Text>
					<Button
						label="Next lines"
						variant="ghost"
						disabled={page === pageCount - 1}
						onPress={() => setSelectedPage(page + 1)}
					/>
				</View>
			) : null}
			<ScrollView horizontal showsHorizontalScrollIndicator>
				<View
					style={{
						minWidth: "100%",
						paddingVertical: 4,
						backgroundColor: theme.color.surface,
					}}
				>
					{lines.length ? (
						lines.map((line, index) => (
							<DiffLine key={`${start + index}`} line={line} />
						))
					) : (
						<Text variant="small" tone="muted" style={{ padding: 10 }}>
							No line preview available.
						</Text>
					)}
				</View>
			</ScrollView>
		</ScrollView>
	);
}

function DiffLine({
	line,
	compact = false,
}: {
	line: MobileDiffLine;
	compact?: boolean;
}) {
	const theme = useTheme();
	const prefix =
		line.kind === "addition"
			? "+"
			: line.kind === "deletion"
				? "−"
				: line.kind === "header"
					? ""
					: " ";
	const color =
		line.kind === "addition"
			? theme.feedback.success.fg
			: line.kind === "deletion"
				? theme.color.danger
				: line.kind === "header"
					? theme.brand.violet
					: theme.color.textMuted;
	const backgroundColor =
		line.kind === "addition"
			? withAlpha(theme.feedback.success.fg, 0.09)
			: line.kind === "deletion"
				? withAlpha(theme.color.danger, 0.09)
				: "transparent";
	return (
		<View
			style={{
				minHeight: compact ? 18 : 22,
				paddingHorizontal: compact ? 4 : 10,
				justifyContent: "center",
				backgroundColor,
			}}
		>
			<Text
				variant="mono"
				color={color}
				numberOfLines={compact ? 1 : undefined}
			>
				{prefix}
				{line.text || " "}
			</Text>
		</View>
	);
}

function DiffTotals({
	additions,
	deletions,
}: {
	additions: number;
	deletions: number;
}) {
	const theme = useTheme();
	return (
		<View style={{ flexDirection: "row", gap: 6 }}>
			{additions > 0 ? (
				<Text variant="mono" color={theme.feedback.success.fg}>
					+{additions}
				</Text>
			) : null}
			{deletions > 0 ? (
				<Text variant="mono" tone="danger">
					−{deletions}
				</Text>
			) : null}
		</View>
	);
}

function displayPath(path: string): string {
	return path.split(/[\\/]/).at(-1) || path;
}
