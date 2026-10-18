import { redirect } from "next/navigation";
import { MobileTopbar, Sidebar } from "@/components/app-shell";
import { InlineAlert } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { getOrCreateProfile, hasPersonalOpenRouterKey } from "@/lib/profile";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
	const user = await getCurrentUser();
	if (!user) redirect("/sign-in?next=/app");

	const [profile, personalKey] = await Promise.all([
		getOrCreateProfile(user),
		hasPersonalOpenRouterKey(user.id),
	]);

	const shellUser = {
		email: user.email ?? profile.email,
		name: profile.display_name,
		plan: profile.plan,
		avatarUrl: profile.avatar_url,
	};

	const sandboxReady = Boolean(process.env.DAYTONA_API_KEY);
	const modelReady = Boolean(process.env.OPENROUTER_API_KEY) || personalKey;
	const missing: string[] = [];
	if (!sandboxReady) missing.push("DAYTONA_API_KEY");
	if (!modelReady) missing.push("OPENROUTER_API_KEY (or a personal key in Settings)");

	return (
		<div className="flex min-h-dvh">
			<Sidebar user={shellUser} sandboxReady={sandboxReady} modelReady={modelReady} />
			<div className="flex min-w-0 flex-1 flex-col">
				<MobileTopbar user={shellUser} />
				{missing.length > 0 ? (
					<div className="px-4 pt-4 lg:px-8">
						<InlineAlert tone="warning" title="Server configuration incomplete">
							The app is running, but tasks cannot execute until the operator sets{" "}
							<span className="font-mono text-[0.7rem]">{missing.join(", ")}</span>. You can still
							browse projects and configure settings.
						</InlineAlert>
					</div>
				) : null}
				<main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 lg:px-8 lg:py-8">
					{children}
				</main>
			</div>
		</div>
	);
}
