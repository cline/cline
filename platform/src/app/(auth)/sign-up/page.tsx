import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
	return (
		<Suspense>
			<AuthForm mode="sign-up" />
		</Suspense>
	);
}
