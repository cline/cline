import { useRouter } from "expo-router";
import { devHubEndpoint } from "@/config/env";
import { chatRouteParams } from "@/connection";
import { SettingsScreen } from "@/screens";

/** Route adapter: account, auto-approve settings and the Advanced connect form. */
export default function SettingsRoute() {
	const router = useRouter();
	return (
		<SettingsScreen
			onBack={() => router.back()}
			devHubEndpoint={devHubEndpoint}
			// Connecting by hand is a real connect: it lands in the chat, exactly like
			// picking a session from the list.
			onConnect={(descriptor) =>
				router.replace({
					pathname: "/chat",
					params: chatRouteParams(descriptor),
				})
			}
			// Signing out invalidates every cloud connection this stack was built on,
			// so drop the history and land on the session list.
			onSignedOut={() => router.replace("/")}
			onConfigureCloud={() =>
				router.replace({ pathname: "/", params: { cloud: "1" } })
			}
			onPairComputer={() => router.push("/scan")}
		/>
	);
}
