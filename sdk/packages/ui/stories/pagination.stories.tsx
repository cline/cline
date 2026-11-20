import type { Meta, StoryObj } from "@storybook/react-vite";
import { useArgs } from "storybook/preview-api";
import { fn } from "storybook/test";
import { Pagination, type PaginationProps } from "../components/pagination";

const meta: Meta<typeof Pagination> = {
	title: "Components/Pagination",
	component: Pagination,
	tags: ["autodocs"],
	parameters: {
		docs: {
			description: {
				component:
					"Page navigation with a moving rounded selection and a window centered on the selected page, except near either end. The first and last pages stay visible. At most five page/ellipsis slots are shown by default, excluding previous/next buttons. Ellipses mark skipped pages and become adjacent numbers near the ends, keeping the width and slot count fixed while navigating. It composes the shared buttons and uses the Cline semantic theme. Hosts own the displayed results, data fetching, and URL state.",
			},
		},
	},
	decorators: [
		(Story) => (
			<div className="flex min-h-40 min-w-0 items-center justify-center p-6">
				<Story />
			</div>
		),
	],
	args: {
		"aria-label": "Results pages",
		pageCount: 10,
		defaultPage: 1,
		visiblePages: 5,
		disabled: false,
		onPageChange: fn(),
	},
	argTypes: {
		pageCount: { control: { type: "number", min: 1, step: 1 } },
		page: { control: { type: "number", min: 1, step: 1 } },
		defaultPage: { control: { type: "number", min: 1, step: 1 } },
		visiblePages: { control: { type: "number", min: 5, max: 50, step: 1 } },
		size: { control: "select", options: ["xxs", "xs", "sm", "md", "lg"] },
		disabled: { control: "boolean" },
		onPageChange: { control: false },
		getPageLabel: { control: false },
	},
};

export default meta;
type Story = StoryObj<typeof Pagination>;

export const Default: Story = {};

export const CompactManyPages: Story = {
	args: { size: "xxs", pageCount: 1_000_000, defaultPage: 500_000 },
};

export const Controlled: Story = {
	args: { defaultPage: undefined, page: 4 },
	render: function Controlled(args) {
		const [{ page = 1 }, updateArgs] = useArgs<PaginationProps>();
		return (
			<div className="grid justify-items-center gap-4">
				<Pagination
					{...args}
					page={page}
					onPageChange={(nextPage) => {
						updateArgs({ page: nextPage });
						args.onPageChange?.(nextPage);
					}}
				/>
				<output className="text-cline-ui-muted-foreground text-cline-ui-sm">
					Page {page} of {args.pageCount}
				</output>
			</div>
		);
	},
};

export const Sizes: Story = {
	parameters: {
		docs: {
			description: {
				story:
					"The pagination-only xxs size is 1.5rem tall at default spacing, with radius-sm corners, text-xxs typography, and 0.75rem arrow icons. The default component size remains xs.",
			},
		},
	},
	render: (args) => (
		<div className="grid justify-items-center gap-6">
			{(["xxs", "xs", "sm", "md", "lg"] as const).map((size) => (
				<div className="grid justify-items-center gap-2" key={size}>
					<span className="text-cline-ui-muted-foreground text-cline-ui-xs">
						{size}
					</span>
					<Pagination
						{...args}
						aria-label={`${size} results pages`}
						defaultPage={3}
						size={size}
					/>
				</div>
			))}
		</div>
	),
};

export const ManyPages: Story = {
	args: { pageCount: 10_000, defaultPage: 5_000 },
	parameters: {
		docs: {
			description: {
				story:
					"Ten thousand pages use five fixed slots: the first page, an ellipsis, the selected page, an ellipsis, and the last page. Near either end, adjacent page numbers replace the ellipses without changing the width or slot count. Previous/next buttons sit outside this limit. The host only needs to render the current page's results.",
			},
		},
	},
};

export const FewPages: Story = {
	args: { pageCount: 3, defaultPage: 2 },
	argTypes: { pageCount: { control: false } },
	render: (args) => (
		<div className="grid justify-items-center gap-6">
			{[2, 3, 4, 5, 6, 7].map((pageCount) => (
				<div className="grid justify-items-center gap-2" key={pageCount}>
					<span className="text-cline-ui-muted-foreground text-cline-ui-xs">
						{pageCount} pages
					</span>
					<Pagination
						{...args}
						aria-label={`${pageCount} pages`}
						pageCount={pageCount}
					/>
				</div>
			))}
		</div>
	),
};

export const Disabled: Story = {
	args: { disabled: true, defaultPage: 3 },
};

export const RightToLeft: Story = {
	args: {
		"aria-label": "صفحات النتائج",
		dir: "rtl",
		defaultPage: 3,
		previousLabel: "الصفحة السابقة",
		nextLabel: "الصفحة التالية",
		getPageLabel: (page) => `الصفحة ${page}`,
	},
};
