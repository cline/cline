import { useLocalSearchParams, useRouter } from "expo-router";
import { chatRouteParams } from "@/connection";
import { HomeScreen } from "@/screens";
import { stagePendingHomeSubmission } from "@/state/pending-home-message";

/** Route adapter: the session list (home) + navigation into a session's chat. */
export default function HomeRoute() {
	const router = useRouter();
	// Set when the chat header sends the user back here, so the row they came from
	// is marked as the live one.
	const params = useLocalSearchParams<{
		activeKey?: string;
		cloud?: string;
		setup?: string;
		sessions?: string;
		recoveryJobId?: string;
	}>();

	return (
		<HomeScreen
			forceSetup={params.setup === "1"}
			preferCloudOnMount={params.cloud === "1"}
			openSessionsOnMount={params.sessions === "1"}
			onSessionsOpened={() => router.setParams({ sessions: undefined })}
			recoveryJobId={params.recoveryJobId}
			{...(params.activeKey ? { activeKey: params.activeKey } : {})}
			onOpenSession={(
				descriptor,
				initialMessage,
				createNewSession,
				attachments,
			) => {
				const launchMessageId =
					initialMessage || attachments?.userImages?.length
						? stagePendingHomeSubmission({
								text: initialMessage ?? "",
								...(attachments ? { attachments } : {}),
							})
						: undefined;
				router.push({
					pathname: "/chat",
					params: {
						...chatRouteParams(descriptor, createNewSession),
						...(launchMessageId ? { launchMessageId } : {}),
					},
				});
			}}
			onOpenSettings={() => router.push("/settings")}
			onConfigureCloud={() =>
				router.push({ pathname: "/", params: { cloud: "1" } })
			}
			onOpenCloudStart={(jobId) =>
				router.push({ pathname: "/cloud-start", params: { jobId } })
			}
			onScanHandoff={() => router.push("/scan")}
			onFinishSetup={() => router.replace("/")}
		/>
	);
}
