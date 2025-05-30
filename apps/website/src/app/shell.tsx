import { getGitHubStars, getVSCodeDownloads } from "@/lib/stats"

import { NavBar, Footer } from "@/components/chromes"

// Invalidate cache when a request comes in, at most once every hour.
export const revalidate = 3600

export default async function Shell({ children }: { children: React.ReactNode }) {
	const [stars, downloads] = await Promise.all([getGitHubStars(), getVSCodeDownloads()])

	return (
		<div className="flex min-h-screen flex-col bg-background text-foreground">
			<NavBar stars={stars} downloads={downloads} />
			<main className="flex-1">{children}</main>
			<Footer />
		</div>
	)
}
