import { Pagination } from "@cline/ui";

/** The visible range and page controls below a paged list; hidden when one page holds everything. */
export function PaginationFooter({
	page,
	pageSize,
	total,
	itemLabel,
	"aria-label": ariaLabel,
	onPageChange,
}: {
	page: number;
	pageSize: number;
	total: number;
	/** Plural noun after the total, e.g. "schedules". */
	itemLabel?: string;
	"aria-label": string;
	onPageChange: (page: number) => void;
}) {
	if (total <= pageSize) return null;
	const first = (page - 1) * pageSize + 1;
	const last = Math.min(page * pageSize, total);
	return (
		<div className="mt-4 flex flex-wrap items-center justify-between gap-3">
			<output className="text-muted-foreground text-sm">
				{`${first}–${last} of ${total}${itemLabel ? ` ${itemLabel}` : ""}`}
			</output>
			<Pagination
				aria-label={ariaLabel}
				page={page}
				pageCount={Math.ceil(total / pageSize)}
				onPageChange={onPageChange}
			/>
		</div>
	);
}
