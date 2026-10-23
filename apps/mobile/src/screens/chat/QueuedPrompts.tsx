/**
 * The machine's turn queue, rendered above the composer.
 *
 * Sending while the agent is working is not an error the client has to prevent:
 * the hub holds the prompt (`runTurn` defaults `delivery` to "queue" when an
 * interactive session cannot start a run) and replays it when the turn ends. The
 * composer has always said so — "Agent is working… Send another message to queue
 * it" — but nothing showed the queue afterwards, which is what made it read as a
 * message swallowed rather than a message parked.
 *
 * Each entry can be removed, and a queued one can be promoted to "steer", which
 * is the phone-shaped affordance that matters: interrupting a turn already in
 * flight with "actually, do this" instead of waiting for it to finish.
 */

import { CornerDownRight, Pencil, X, Zap } from "lucide-react-native";
import { useRef, useState } from "react";
import { Keyboard, TextInput, View } from "react-native";
import { userErrorMessage } from "@/error-message";
import type { PendingPromptView } from "@/session";
import { Button, IconButton, Text, useTheme } from "@/ui";

export interface QueuedPromptsProps {
	prompts: PendingPromptView[];
	/** Steering only means something while a turn is actually running. */
	running: boolean;
	onRemove(promptId: string): void | Promise<void>;
	onSteer(promptId: string): void | Promise<void>;
	onEdit?(promptId: string, prompt: string): void | Promise<void>;
}

export function QueuedPrompts({
	prompts,
	running,
	onRemove,
	onSteer,
	onEdit,
}: QueuedPromptsProps) {
	if (prompts.length === 0) {
		return null;
	}

	return (
		<View testID="queued-prompts" style={{ gap: 4, paddingBottom: 8 }}>
			<Text variant="caption" tone="muted">
				{prompts.length === 1 ? "1 queued" : `${prompts.length} queued`}
			</Text>
			{prompts.map((entry) => (
				<QueuedPrompt
					key={entry.id}
					entry={entry}
					running={running}
					onRemove={onRemove}
					onSteer={onSteer}
					onEdit={onEdit}
				/>
			))}
		</View>
	);
}

function QueuedPrompt({
	entry,
	running,
	onRemove,
	onSteer,
	onEdit,
}: Omit<QueuedPromptsProps, "prompts"> & { entry: PendingPromptView }) {
	const theme = useTheme();
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(entry.prompt);
	const [pending, setPending] = useState(false);
	const pendingRef = useRef(false);
	const [error, setError] = useState<string>();
	const perform = async (action: () => void | Promise<void>) => {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPending(true);
		setError(undefined);
		try {
			await action();
			if (editing) Keyboard.dismiss();
			setEditing(false);
		} catch (cause) {
			setError(
				userErrorMessage(
					cause,
					"Couldn't update this queued message. Try again.",
				),
			);
		} finally {
			pendingRef.current = false;
			setPending(false);
		}
	};
	const steering = entry.delivery === "steer";
	return (
		<View style={{ gap: 6 }}>
			<View
				key={entry.id}
				testID={`queued-prompt-${entry.id}`}
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: 8,
					borderWidth: 1,
					borderColor: steering ? theme.brand.violetBorder : theme.color.border,
					borderRadius: theme.radius.sm,
					backgroundColor: theme.color.surfaceMuted,
					paddingLeft: 8,
					paddingRight: 4,
					paddingVertical: 6,
				}}
			>
				{steering ? (
					<Zap size={12} color={theme.brand.violetEmphasis} />
				) : (
					<CornerDownRight size={12} color={theme.color.textMuted} />
				)}
				{/* numberOfLines keeps a pasted paragraph from taking the screen. */}
				<Text variant="body" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
					{entry.prompt}
				</Text>
				{running && !steering ? (
					<IconButton
						accessibilityLabel={`Send "${entry.prompt}" now`}
						onPress={() => void perform(() => onSteer(entry.id))}
						disabled={pending}
						hitSlop={6}
					>
						<Zap size={14} color={theme.brand.violetEmphasis} />
					</IconButton>
				) : null}
				{onEdit ? (
					<IconButton
						accessibilityLabel={`Edit "${entry.prompt}"`}
						disabled={pending}
						onPress={() => {
							Keyboard.dismiss();
							setDraft(entry.prompt);
							setEditing(true);
							setError(undefined);
						}}
					>
						<Pencil size={14} color={theme.color.textMuted} />
					</IconButton>
				) : null}
				<IconButton
					accessibilityLabel={`Remove "${entry.prompt}" from the queue`}
					onPress={() => void perform(() => onRemove(entry.id))}
					disabled={pending}
					hitSlop={6}
				>
					<X size={14} color={theme.color.textMuted} />
				</IconButton>
			</View>
			{editing ? (
				<View style={{ gap: 8 }}>
					<TextInput
						keyboardAppearance={theme.mode}
						accessibilityLabel="Edit queued message"
						multiline
						value={draft}
						onChangeText={setDraft}
						editable={!pending}
						style={{
							color: theme.color.text,
							backgroundColor: theme.color.surfaceMuted,
							padding: 12,
							borderWidth: 1,
							borderColor: theme.color.border,
							borderRadius: theme.radius.sm,
							minHeight: 64,
							maxHeight: 120,
						}}
					/>
					<View style={{ flexDirection: "row", gap: 8 }}>
						<Button
							label="Save message"
							loading={pending}
							disabled={pending || !draft.trim()}
							onPress={() =>
								void perform(() => onEdit?.(entry.id, draft.trim()))
							}
						/>
						<Button
							label="Cancel edit"
							variant="secondary"
							disabled={pending}
							onPress={() => {
								Keyboard.dismiss();
								setEditing(false);
								setError(undefined);
							}}
						/>
					</View>
				</View>
			) : null}
			{pending ? (
				<Text variant="caption" tone="muted">
					Updating queued message…
				</Text>
			) : null}
			{error ? (
				<Text variant="caption" tone="danger" accessibilityRole="alert">
					{error}
				</Text>
			) : null}
		</View>
	);
}
