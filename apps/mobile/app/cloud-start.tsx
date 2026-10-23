import { useLocalSearchParams, useRouter } from "expo-router";
import { chatRouteParams } from "@/connection";
import { CloudProvisioningScreen } from "@/screens";
import { stagePendingHomeSubmission } from "@/state/pending-home-message";

/** Keeps Cloud creation inside the conversation flow instead of on Home. */
export default function CloudStartRoute() {
	const router = useRouter();
	const { jobId } = useLocalSearchParams<{ jobId?: string }>();

	return (
		<CloudProvisioningScreen
			jobId={jobId ?? ""}
			onBack={() =>
				router.dismissTo({ pathname: "/", params: { sessions: "1" } })
			}
			onCheckSessions={() =>
				router.dismissTo({
					pathname: "/",
					params: { sessions: "1", recoveryJobId: jobId ?? "" },
				})
			}
			onReady={(job) => {
				const launchMessageId = job.submitted
					? undefined
					: stagePendingHomeSubmission({
							text: job.message,
							...(job.attachments ? { attachments: job.attachments } : {}),
						});
				router.replace({
					pathname: "/chat",
					params: {
						...chatRouteParams(job.descriptor, !job.submitted),
						launchMessageId,
					},
				});
			}}
		/>
	);
}
