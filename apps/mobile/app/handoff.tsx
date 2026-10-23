import { useLocalSearchParams, useRouter } from "expo-router";
import { chatRouteParams } from "@/connection";
import { HandoffScreen } from "@/screens";

/**
 * Route adapter for `clinecode://handoff?...`.
 *
 * Expo Router maps a custom-scheme deep link's host onto the first path segment
 * (`extractExpoPathFromURL`), so `clinecode://handoff?v=1&…` lands here with the
 * query intact — on a cold start (the router resolves the launch URL before the
 * first render) and while warm (the same linking subscription handles the event).
 * `app.json`'s `"scheme": "clinecode"` is all the native side needs.
 *
 * Navigation is always `replace`: the handoff link is consumed, and Back from the
 * session should not return to a used-up link.
 */
export default function HandoffRoute() {
	const router = useRouter();
	const params = useLocalSearchParams();

	return (
		<HandoffScreen
			params={params}
			onOpenSession={(descriptor) => {
				router.replace({
					pathname: "/chat",
					params: chatRouteParams(descriptor),
				});
			}}
			onPaired={() => router.replace("/")}
			onDismiss={() => router.replace("/")}
		/>
	);
}
