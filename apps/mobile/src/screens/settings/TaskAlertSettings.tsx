import { useEffect, useRef, useState } from "react";
import { Linking } from "react-native";
import {
	setTaskAlertsEnabled,
	taskAlertsEnabled,
} from "@/notifications/attention-notifications";
import { Button, Surface, Text } from "@/ui";

export function TaskAlertSettings() {
	const [enabled, setEnabled] = useState<boolean>();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const busyRef = useRef(false);
	const mounted = useRef(true);
	useEffect(() => {
		let active = true;
		mounted.current = true;
		void taskAlertsEnabled()
			.then((value) => {
				if (active) setEnabled(value);
			})
			.catch(() => {
				if (active) setEnabled(false);
			});
		return () => {
			active = false;
			mounted.current = false;
		};
	}, []);
	return (
		<Surface level="muted" bordered padding={12} style={{ gap: 10 }}>
			<Text weight="500">Task alerts</Text>
			<Text variant="small" tone="muted">
				Get alerts for approvals, questions, errors, and finished tasks while
				Cline is connected. Alerts can pause when your phone puts the app to
				sleep.
			</Text>
			<Button
				label={enabled ? "Turn off task alerts" : "Enable task alerts"}
				variant="outline"
				disabled={busy || enabled === undefined}
				onPress={() => {
					if (busyRef.current) return;
					busyRef.current = true;
					setBusy(true);
					setError(undefined);
					void setTaskAlertsEnabled(!enabled)
						.then((value) => {
							if (!mounted.current) return;
							setEnabled(value);
							if (!value && !enabled)
								setError(
									"Notifications are disabled. Allow Cline notifications in system settings.",
								);
						})
						.catch(() => {
							if (mounted.current)
								setError("Could not update task alerts. Try again.");
						})
						.finally(() => {
							busyRef.current = false;
							if (mounted.current) setBusy(false);
						});
				}}
			/>
			{error ? (
				<>
					<Text tone="danger" accessibilityRole="alert">
						{error}
					</Text>
					<Button
						label="Open notification settings"
						variant="ghost"
						onPress={() => {
							void Linking.openSettings().catch(() => {});
						}}
					/>
				</>
			) : null}
		</Surface>
	);
}
