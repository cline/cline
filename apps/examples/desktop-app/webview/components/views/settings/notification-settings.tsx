import { Switch } from "@cline/ui";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { useTranslation } from "@/lib/i18n";

const EVENT_COPY: Record<
	DesktopNotificationEventType,
	{ labelKey: string; descriptionKey: string }
> = {
	taskCompletion: {
		labelKey: "settings.general.notifications.event.taskCompletion.label",
		descriptionKey:
			"settings.general.notifications.event.taskCompletion.description",
	},
	approvalNeeded: {
		labelKey: "settings.general.notifications.event.approvalNeeded.label",
		descriptionKey:
			"settings.general.notifications.event.approvalNeeded.description",
	},
	questionAsked: {
		labelKey: "settings.general.notifications.event.questionAsked.label",
		descriptionKey:
			"settings.general.notifications.event.questionAsked.description",
	},
	sessionError: {
		labelKey: "settings.general.notifications.event.sessionError.label",
		descriptionKey:
			"settings.general.notifications.event.sessionError.description",
	},
};

export function NotificationSettings() {
	const { t } = useTranslation();
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
				{t("settings.general.notifications.allowedBySystem")}
			</span>
		) : permission === "unsupported" ? null : permission === null ? (
			<span className="shrink-0 text-xs text-muted-foreground">
				{t("settings.general.notifications.checking")}
			</span>
		) : (
			<Button
				disabled={requestingPermission}
				onClick={() => void requestPermission()}
				size="sm"
				type="button"
				variant="outline"
			>
				{permission === "denied"
					? t("settings.general.notifications.checkPermission")
					: t("settings.general.notifications.allowNotifications")}
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
						{t("settings.general.notifications.title")}
					</p>
					<p className="text-sm text-muted-foreground">
						{t("settings.general.notifications.description")}
					</p>
					{permission === "denied" ? (
						<p className="mt-1 text-xs text-destructive">
							{t("settings.general.notifications.blocked")}
						</p>
					) : null}
				</div>
				{permissionControl}
			</div>
			<div className="mt-4 rounded-lg border bg-card px-4">
				<div className="grid grid-cols-[minmax(0,1fr)_5rem_4rem] items-center gap-3 border-b py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					<span>{t("settings.general.notifications.column.event")}</span>
					<span className="text-center">
						{t("settings.general.notifications.column.notify")}
					</span>
					<span className="text-center">
						{t("settings.general.notifications.column.sound")}
					</span>
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
									{t(copy.labelKey)}
								</p>
								<p className="text-xs text-muted-foreground">
									{t(copy.descriptionKey)}
								</p>
							</div>
							<div className="flex justify-center">
								<Switch
									aria-label={t("settings.general.notifications.aria.notify", {
										event: t(copy.labelKey),
									})}
									checked={preference.enabled}
									onCheckedChange={(checked) =>
										updatePreference(eventType, "enabled", checked)
									}
								/>
							</div>
							<div className="flex justify-center">
								<Switch
									aria-label={t("settings.general.notifications.aria.sound", {
										event: t(copy.labelKey),
									})}
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
