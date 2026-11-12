"use client";

import { Plus } from "lucide-react";
import { FACTORY_INTAKE } from "@/lib/factory-copy";

/**
 * Shown above the composer while it is collecting Factory work: what happens
 * next. The repository is the folder chip above, so it is not repeated here.
 */
export function FactoryIntakeNotice() {
	return (
		<div
			className="mx-auto mt-6 max-w-2xl px-4 text-center"
			data-factory-notice="intake"
		>
			<p className="flex items-center justify-center gap-2 text-sm font-semibold text-foreground">
				<span
					aria-hidden
					className="flex size-5 items-center justify-center rounded-md bg-primary text-primary-foreground"
				>
					<Plus className="size-3.5" />
				</span>
				{FACTORY_INTAKE.title}
			</p>
			<p className="mt-1 text-sm text-muted-foreground">
				{FACTORY_INTAKE.description}
			</p>
		</div>
	);
}
