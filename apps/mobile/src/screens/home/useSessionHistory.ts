import { useMemo } from "react";
import { cloudEnv } from "@/config/env";
import {
	useCloudSessionStatuses,
	useUnreadCloudSessions,
} from "@/connection/use-cloud-session-statuses";
import type { RunStatus } from "@/session";
import { useCloudAccountScope } from "@/state/cloud-auth";
import { useEndpoints } from "@/state/endpoints";
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
	const { scope } = useCloudAccountScope();
	const { lastOpened } = useLastOpened();
	const cloud = useCloudSessions(cloudOptions);
	const local = useLocalSessions(endpoints);
	const cloudStatuses = useCloudSessionStatuses();
	const unreadCloudSessions = useUnreadCloudSessions();
	const rows = useMemo(
		() =>
			buildSessionRows({
				endpoints,
				localSessions: local.sessions,
				// A scope change renders before its replacement request completes.
				// Never paint cached rows from another account in that interval.
				cloudSessions: scope
					? (getCloudSessions(cloud.state) ?? []).filter(
							(session) => session.organizationId === scope.organizationId,
						)
					: [],
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
			scope,
			cloudStatuses,
			unreadCloudSessions,
			lastOpened,
			activeKey,
			activeStatus,
		],
	);
	return { cloud, local, rows };
}
