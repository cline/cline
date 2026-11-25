import { Compass, Home } from "lucide-react";
import Link from "next/link";
import { BrandLink } from "@/components/brand";

export default function NotFound() {
	return (
		<div className="relative flex min-h-dvh flex-col">
			<div className="pointer-events-none absolute inset-x-0 top-0 h-96 grid-noise" />
			<header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
				<BrandLink href="/app" />
			</header>
			<main className="relative z-10 flex flex-1 items-center justify-center px-6">
				<div className="max-w-md text-center">
					<span className="mx-auto grid size-12 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-mist-400">
						<Compass className="size-5" />
					</span>
					<p className="eyebrow mt-6">404</p>
					<h1 className="display mt-3 text-3xl font-semibold">This path doesn&apos;t exist.</h1>
					<p className="mt-3 text-sm leading-relaxed text-mist-500">
						The project or task may have been deleted, or you may not have access to it.
					</p>
					<div className="mt-6 flex justify-center gap-3">
						<Link href="/app" className="btn btn-primary">
							<Home className="size-4" /> Back to dashboard
						</Link>
						<Link href="/app/projects" className="btn btn-secondary">
							Projects
						</Link>
					</div>
				</div>
			</main>
		</div>
	);
}
