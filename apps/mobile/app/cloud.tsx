import { useLocalSearchParams, useRouter } from "expo-router";
import { chatRouteParams } from "@/connection";
import { DestinationScreen } from "@/screens";

/** Cline Cloud owns account state and Cloud sessions. */
export default function CloudRoute() {
	const router = useRouter();
	const { activeKey } = useLocalSearchParams<{ activeKey?: string }>();
	return (
		<DestinationScreen
			destination="cloud"
			{...(activeKey ? { activeKey } : {})}
			onBack={() => router.replace("/")}
			onOpenSettings={() => router.push("/settings")}
			onOpenSession={(descriptor) =>
				router.push({ pathname: "/chat", params: chatRouteParams(descriptor) })
			}
		/>
	);
}
