import { useEffect, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";

/**
 * Device sign-in confirmation code pushed by the sidecar while a provider
 * OAuth login is pending, so the user can match it against the code shown in
 * their browser. Cleared whenever the pending flow ends.
 */
export function useOAuthUserCode(pending: boolean): string | null {
	const [userCode, setUserCode] = useState<string | null>(null);
	useEffect(() => {
		if (!pending) {
			setUserCode(null);
			return;
		}
		return desktopClient.subscribe("provider_oauth_user_code", (payload) => {
			const code = (payload as { userCode?: unknown } | null)?.userCode;
			if (typeof code === "string" && code) {
				setUserCode(code);
			}
		});
	}, [pending]);
	return userCode;
}
