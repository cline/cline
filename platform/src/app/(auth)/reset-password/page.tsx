import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
	return (
		<Suspense>
			<AuthForm mode="reset" />
		</Suspense>
	);
}
