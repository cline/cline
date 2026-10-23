import { useMemo } from "react";
import { cloudEnv } from "@/config/env";
import {
	useCloudSessionStatuses,
	useUnreadCloudSessions,
} from "@/connection/use-cloud-session-statuses";
import type { RunStatus } from "@/session";
import { useEndpoints } from "@/state/endpoints";
import { useExecutionTargets } from "@/state/execution-targets";
import { useLastOpened } from "@/state/last-opened";
import {
	getCloudSessions,
	type UseCloudSessionsOptions,
	useCloudSessions,
} from "./cloud-sessions";
import { useLocalSessions } from "./local-sessions";
import { buildSessionRows } from "./session-rows";

export function useSessionHistory({
	activeKey,
	activeStatus,
	...cloudOptions
}: Pick<
	UseCloudSessionsOptions,
	"openVerificationUrl" | "refreshIntervalMs"
> & {
	activeKey?: string;
	activeStatus?: RunStatus;
}) {
	const { endpoints } = useEndpoints();
	const { cloudTargets } = useExecutionTargets();
	const { lastOpened } = useLastOpened();
	const organizationIds = useMemo(
		() => [
			...new Set(
				[
					...cloudTargets,
					...endpoints.filter((endpoint) => endpoint.mode === "cloud"),
				].flatMap((source) =>
					source.organizationId ? [source.organizationId] : [],
				),
			),
		],
		[cloudTargets, endpoints],
	);
	const cloud = useCloudSessions({ ...cloudOptions, organizationIds });
	const local = useLocalSessions(endpoints);
	const cloudStatuses = useCloudSessionStatuses();
	const unreadCloudSessions = useUnreadCloudSessions();
	const rows = useMemo(
		() =>
			buildSessionRows({
				endpoints,
				localSessions: local.sessions,
				cloudSessions: getCloudSessions(cloud.state),
				cloudApiBaseUrl: cloudEnv.apiBaseUrl,
				cloudStatuses,
				unreadCloudSessions,
				lastOpened,
				activeKey,
				activeStatus,
			}),
		[
			endpoints,
			local.sessions,
			cloud.state,
			cloudStatuses,
			unreadCloudSessions,
			lastOpened,
			activeKey,
			activeStatus,
		],
	);
	return { cloud, local, rows };
}
