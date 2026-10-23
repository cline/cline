import { useLocalSearchParams, useRouter } from "expo-router";
import { chatRouteParams } from "@/connection";
import { DestinationScreen } from "@/screens";

/** My Computers owns pairing and sessions reached through paired machines. */
export default function ComputersRoute() {
	const router = useRouter();
	const { activeKey } = useLocalSearchParams<{ activeKey?: string }>();
	return (
		<DestinationScreen
			destination="computers"
			{...(activeKey ? { activeKey } : {})}
			onBack={() => router.replace("/")}
			onOpenSettings={() => router.push("/settings")}
			onScanHandoff={() => router.push("/scan")}
			onOpenSession={(descriptor) =>
				router.push({ pathname: "/chat", params: chatRouteParams(descriptor) })
			}
		/>
	);
}
