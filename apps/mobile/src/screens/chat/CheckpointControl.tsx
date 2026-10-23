import { Split } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Keyboard, Modal, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { UseSessionConnection } from "@/connection";
import { userErrorMessage } from "@/error-message";
import { Button, Text, useTheme } from "@/ui";
import { ComposerPill } from "./ComposerPill";

type Checkpoint = { runCount: number; createdAt?: number };

export function CheckpointControl({
	connection,
	disabled,
	onFork,
	beforeOpen,
}: {
	connection: UseSessionConnection;
	disabled: boolean;
	onFork(sessionId: string): Promise<void>;
	beforeOpen?(open: () => void): void;
}) {
	const theme = useTheme();
	const [open, setOpen] = useState(false);
	const insets = useSafeAreaInsets();
	const [checkpoints, setCheckpoints] = useState<readonly Checkpoint[]>([]);
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const [error, setError] = useState<string>();
	const [forkedId, setForkedId] = useState<string>();
	const load = async () => {
		if (busyRef.current || disabled) return;
		busyRef.current = true;
		setBusy(true);
		setError(undefined);
		Keyboard.dismiss();
		setOpen(true);
		try {
			setCheckpoints(await connection.listCheckpoints());
		} catch (cause) {
			setError(userErrorMessage(cause, "Couldn't load saved checkpoints."));
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	};
	const fork = async (runCount?: number) => {
		if (busyRef.current || disabled) return;
		busyRef.current = true;
		setBusy(true);
		setError(undefined);
		try {
			let id = forkedId;
			if (!id) {
				if (runCount === undefined) return;
				id = await connection.forkAtCheckpoint(runCount);
			}
			if (!mounted.current) return;
			setForkedId(id);
			await onFork(id);
			setOpen(false);
		} catch (cause) {
			setError(userErrorMessage(cause, "Couldn't open the conversation fork."));
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	};
	return (
		<>
			<ComposerPill
				label="Fork"
				leading={<Split size={14} color={theme.color.textMuted} />}
				accessibilityLabel="Fork from checkpoint"
				onPress={
					disabled
						? undefined
						: () => {
								const open = () => void load();
								if (beforeOpen) beforeOpen(open);
								else open();
							}
				}
			/>
			<Modal
				visible={open}
				supportedOrientations={[
					"portrait",
					"portrait-upside-down",
					"landscape",
				]}
				onRequestClose={() => {
					if (!busyRef.current) setOpen(false);
				}}
			>
				<View
					style={{
						flex: 1,
						backgroundColor: theme.color.canvas,
						paddingTop: insets.top,
						paddingBottom: insets.bottom,
						paddingLeft: insets.left,
						paddingRight: insets.right,
					}}
				>
					<Button
						label="Close checkpoints"
						disabled={busy}
						variant="ghost"
						onPress={() => setOpen(false)}
					/>
					<ScrollView contentContainerStyle={{ padding: 16 }}>
						<View style={{ gap: 12 }}>
							<Text weight="600">Fork conversation</Text>
							<Text variant="small" tone="muted">
								Start a new conversation from a saved checkpoint. Both
								conversations use the current workspace files; this does not
								roll files back.
							</Text>
							{busy ? <Text variant="small">Loading…</Text> : null}
							{error ? (
								<Text variant="small" tone="danger" accessibilityRole="alert">
									{error}
								</Text>
							) : null}
							{!busy && !error && checkpoints.length === 0 ? (
								<Text variant="small" tone="muted">
									No saved checkpoints yet. New local sessions save checkpoints
									as work runs.
								</Text>
							) : null}
							{forkedId ? (
								<Button
									label="Open created fork"
									disabled={busy || disabled}
									variant="outline"
									onPress={() => void fork()}
								/>
							) : (
								checkpoints.map((checkpoint) => (
									<Button
										key={checkpoint.runCount}
										label={`Fork before turn ${checkpoint.runCount}`}
										disabled={busy || disabled}
										variant="outline"
										onPress={() => void fork(checkpoint.runCount)}
									/>
								))
							)}
						</View>
					</ScrollView>
				</View>
			</Modal>
		</>
	);
}
