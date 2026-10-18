import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
	return (
		<Suspense>
			<AuthForm mode="sign-in" />
		</Suspense>
	);
}
