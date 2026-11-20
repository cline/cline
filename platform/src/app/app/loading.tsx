export default function AppLoading() {
	return (
		<div className="animate-pulse space-y-6">
			<div className="space-y-3">
				<div className="h-3 w-20 rounded bg-white/[0.06]" />
				<div className="h-8 w-72 rounded bg-white/[0.07]" />
				<div className="h-3 w-96 max-w-full rounded bg-white/[0.05]" />
			</div>
			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				{Array.from({ length: 4 }).map((_, index) => (
					<div key={index} className="surface h-32 p-5">
						<div className="h-3 w-20 rounded bg-white/[0.06]" />
						<div className="mt-6 h-8 w-24 rounded bg-white/[0.08]" />
					</div>
				))}
			</div>
			<div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
				<div className="surface h-80" />
				<div className="surface h-80" />
			</div>
		</div>
	);
}
