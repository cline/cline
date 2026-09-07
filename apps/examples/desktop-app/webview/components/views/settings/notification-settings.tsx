import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
	DESKTOP_NOTIFICATION_EVENT_TYPES,
	type DesktopNotificationEventType,
	type DesktopNotificationPermission,
	type DesktopNotificationSettings,
	getDesktopNotificationPermission,
	readDesktopNotificationSettings,
	requestDesktopNotificationPermission,
	writeDesktopNotificationSettings,
} from "@/lib/desktop-notifications";

const EVENT_COPY: Record<
	DesktopNotificationEventType,
	{ label: string; description: string }
> = {
	taskCompletion: {
		label: "Task completed",
		description: "When Cline finishes a task or turn.",
	},
	approvalNeeded: {
		label: "Approval needed",
		description: "When a tool is waiting for your approval.",
	},
	questionAsked: {
		label: "Question asked",
		description: "When Cline needs an answer before continuing.",
	},
	sessionError: {
		label: "Session error",
		description: "When a task stops because of an error.",
	},
};

export function NotificationSettings() {
	const [settings, setSettings] = useState<DesktopNotificationSettings>(
		readDesktopNotificationSettings,
	);
	const [permission, setPermission] =
		useState<DesktopNotificationPermission | null>(null);
	const [requestingPermission, setRequestingPermission] = useState(false);

	useEffect(() => {
		let cancelled = false;
		void getDesktopNotificationPermission().then((nextPermission) => {
			if (!cancelled) setPermission(nextPermission);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const requestPermission = useCallback(async () => {
		setRequestingPermission(true);
		try {
			setPermission(await requestDesktopNotificationPermission());
		} finally {
			setRequestingPermission(false);
		}
	}, []);

	const updatePreference = (
		eventType: DesktopNotificationEventType,
		field: "enabled" | "sound",
		value: boolean,
	) => {
		setSettings((current) => {
			const next = writeDesktopNotificationSettings({
				...current,
				[eventType]: { ...current[eventType], [field]: value },
			});
			return next;
		});
		if (value && permission !== "granted") {
			void requestPermission();
		}
	};

	const permissionControl =
		permission === "granted" ? (
			<span className="shrink-0 text-xs font-medium text-muted-foreground">
				Allowed by system
			</span>
		) : permission === "unsupported" ? null : permission === null ? (
			<span className="shrink-0 text-xs text-muted-foreground">Checking…</span>
		) : (
			<Button
				disabled={requestingPermission}
				onClick={() => void requestPermission()}
				size="sm"
				type="button"
				variant="outline"
			>
				{permission === "denied" ? "Check permission" : "Allow notifications"}
			</Button>
		);

	// One settings section: a top-level header row like the other General
	// settings, with the per-event matrix nested in a card so its rows read
	// as children of "Desktop notifications" rather than as siblings of
	// top-level settings like Dark mode.
	return (
		<div className="border-b py-4">
			<div className="flex items-center justify-between gap-5 max-[720px]:flex-col max-[720px]:items-stretch">
				<div className="flex flex-col gap-1">
					<p className="text-base font-semibold text-foreground">
						Desktop notifications
					</p>
					<p className="text-sm text-muted-foreground">
						Notify only while the Cline window is in the background. Clicking a
						notification opens its session.
					</p>
					{permission === "denied" ? (
						<p className="mt-1 text-xs text-destructive">
							Notifications are blocked in system settings.
						</p>
					) : null}
				</div>
				{permissionControl}
			</div>
			<div className="mt-4 rounded-lg border bg-card px-4">
				<div className="grid grid-cols-[minmax(0,1fr)_5rem_4rem] items-center gap-3 border-b py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					<span>Event</span>
					<span className="text-center">Notify</span>
					<span className="text-center">Sound</span>
				</div>
				{DESKTOP_NOTIFICATION_EVENT_TYPES.map((eventType) => {
					const copy = EVENT_COPY[eventType];
					const preference = settings[eventType];
					return (
						<div
							className="grid grid-cols-[minmax(0,1fr)_5rem_4rem] items-center gap-3 border-b py-3 last:border-b-0"
							key={eventType}
						>
							<div className="min-w-0">
								<p className="text-sm font-medium text-foreground">
									{copy.label}
								</p>
								<p className="text-xs text-muted-foreground">
									{copy.description}
								</p>
							</div>
							<div className="flex justify-center">
								<Switch
									aria-label={`${copy.label} notifications`}
									checked={preference.enabled}
									onCheckedChange={(checked) =>
										updatePreference(eventType, "enabled", checked)
									}
								/>
							</div>
							<div className="flex justify-center">
								<Switch
									aria-label={`${copy.label} sound`}
									checked={preference.sound}
									disabled={!preference.enabled}
									onCheckedChange={(checked) =>
										updatePreference(eventType, "sound", checked)
									}
								/>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
