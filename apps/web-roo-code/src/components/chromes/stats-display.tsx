import Link from "next/link"
import { RxGithubLogo } from "react-icons/rx"
import { VscVscode } from "react-icons/vsc"
import { getGitHubStars, getVSCodeDownloads } from "@/lib/stats"

export default async function StatsDisplay() {
	const stars = await getGitHubStars()
	const downloads = await getVSCodeDownloads()

	return (
		<>
			<Link
				href="https://github.com/RooCodeInc/Roo-Code"
				target="_blank"
				className="hidden md:flex items-center gap-1.5 text-sm font-medium text-gray-400 hover:text-gray-200">
				<RxGithubLogo className="h-4 w-4" />
				{stars !== null && <span>{stars}</span>}
			</Link>
			<Link
				href="https://marketplace.visualstudio.com/items?itemName=RooVeterinaryInc.roo-cline"
				target="_blank"
				className="hidden md:flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
				<VscVscode className="h-4 w-4" />
				<span>
					Install <span className="font-black">&middot;</span>
				</span>
				{downloads !== null && <span>{downloads}</span>}
			</Link>
		</>
	)
}
