import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { cloudAuthStore } from "@/cloud";
import { chatRouteParams } from "@/connection";
import { cloudLaunches } from "@/connection/cloud-launches";
import { useEndpoints } from "@/state/endpoints";
import { attentionTarget, watchTaskAlerts } from "./attention-notifications";

export function AttentionNotifications() {
	const { store, hydrated } = useEndpoints();
	const router = useRouter();
	useEffect(() => {
		if (!hydrated) return;
		let active = true;
		let generation = 0;
		const retireTaps = cloudLaunches.subscribeAttention((event) => {
			if (event.type === "clear") generation += 1;
		});
		const handled = new Set<string>();
		const open = async (response: Notifications.NotificationResponse) => {
			const current = generation;
			const id = response.notification.request.identifier;
			if (handled.has(id)) return;
			handled.add(id);
			const data = response.notification.request.content.data;
			if (
				!(await cloudAuthStore.getCredentials()) ||
				!active ||
				current !== generation
			)
				return;
			const descriptor = attentionTarget(data, (key) => store.get(key));
			if (!descriptor) return;
			router.push({ pathname: "/chat", params: chatRouteParams(descriptor) });
			Notifications.clearLastNotificationResponse();
		};
		const unsubscribe = watchTaskAlerts(cloudLaunches);
		const subscription = Notifications.addNotificationResponseReceivedListener(
			(response) => {
				void open(response).catch(() => {});
			},
		);
		const last = Notifications.getLastNotificationResponse();
		if (last) void open(last).catch(() => {});
		return () => {
			active = false;
			retireTaps();
			unsubscribe();
			subscription.remove();
		};
	}, [hydrated, store, router]);
	return null;
}
