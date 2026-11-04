import { useSyncExternalStore } from "react";
import {
	getOAuthUserCode,
	subscribeOAuthUserCode,
} from "@/lib/oauth-user-code";
/** Device confirmation codes belong to the initiating webview's OAuth callback. */
export function useOAuthUserCode(pending: boolean): string | null {
	const code = useSyncExternalStore(
		subscribeOAuthUserCode,
		getOAuthUserCode,
		() => null,
	);
	return pending ? code : null;
}
