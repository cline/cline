"use client";

import { AlertOctagon, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error("[21-agent] route error:", error.message);
	}, [error]);

	return (
		<div className="flex min-h-dvh items-center justify-center px-6">
			<div className="max-w-md text-center">
				<span className="mx-auto grid size-12 place-items-center rounded-xl border border-rose-400/20 bg-rose-400/[0.06] text-rose-300">
					<AlertOctagon className="size-5" />
				</span>
				<h1 className="display mt-6 text-3xl font-semibold">Something broke.</h1>
				<p className="mt-3 text-sm leading-relaxed text-mist-500">
					The page could not render. The error is logged server-side without credentials. You can
					retry or return to the dashboard.
				</p>
				{error.digest ? (
					<p className="mt-2 font-mono text-[0.65rem] text-mist-700">ref {error.digest}</p>
				) : null}
				<div className="mt-6 flex justify-center gap-3">
					<button type="button" onClick={reset} className="btn btn-primary">
						<RotateCcw className="size-4" /> Try again
					</button>
					<Link href="/app" className="btn btn-secondary">
						Dashboard
					</Link>
				</div>
			</div>
		</div>
	);
}
