import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageFrame, PageHeader } from "../page-layout";

export function DebugContent({
	onExportDiagnostics,
}: {
	onExportDiagnostics: () => void;
}) {
	return (
		<PageFrame>
			<PageHeader
				title="Debug"
				description="Tools for troubleshooting Cline."
			/>
			<section className="max-w-344">
				<div className="flex py-4 items-center justify-between gap-5 max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:py-4">
					<div className="flex flex-col gap-1">
						<p className="text-base font-semibold text-foreground">
							Diagnostics
						</p>
						<p className="text-sm text-muted-foreground">
							Export app info, recent logs, and the metadata of sessions you
							choose as a file you can attach when reporting a problem.
						</p>
					</div>
					<Button
						className="w-24 shrink-0"
						onClick={onExportDiagnostics}
						size="sm"
						type="button"
						variant="outline"
					>
						<Download className="size-3" />
						Export…
					</Button>
				</div>
			</section>
		</PageFrame>
	);
}
