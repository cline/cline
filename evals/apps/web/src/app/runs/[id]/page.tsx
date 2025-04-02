import { findRun } from "@evals/db"

import { Run } from "./run"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params
	const run = await findRun(Number(id))

	return (
		<div className="max-w-3xl mx-auto px-12 p-12">
			<Run run={run} />
		</div>
	)
}
