import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
	return (
		<Suspense>
			<AuthForm mode="forgot" />
		</Suspense>
	);
}
