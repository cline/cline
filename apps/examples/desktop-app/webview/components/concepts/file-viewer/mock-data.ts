export type GitStatus = "M" | "A" | "D" | "U";
export type AgentTouch = "edited" | "created" | "read";

export type MockFile = {
	path: string;
	git?: GitStatus;
	agent?: AgentTouch;
	additions?: number;
	deletions?: number;
	size?: string;
	modified?: string;
};

export const PROJECT = {
	name: "acme-dashboard",
	branch: "feat/invoice-csv-export",
	root: "~/code/acme-dashboard",
};

export const SESSION_TITLE = "Add CSV export to the invoices table";

export const FILES: MockFile[] = [
	{ path: ".github/workflows/ci.yml", size: "1.2 KB", modified: "3d" },
	{ path: "public/logo.svg", size: "2.4 KB", modified: "2w" },
	{ path: "public/favicon.ico", size: "15 KB", modified: "2w" },
	{
		path: "src/app/api/invoices/route.ts",
		git: "M",
		agent: "edited",
		additions: 14,
		deletions: 2,
		size: "1.8 KB",
		modified: "now",
	},
	{
		path: "src/app/invoices/page.tsx",
		agent: "read",
		size: "1.1 KB",
		modified: "1d",
	},
	{ path: "src/app/layout.tsx", size: "0.9 KB", modified: "5d" },
	{ path: "src/app/page.tsx", size: "1.4 KB", modified: "5d" },
	{
		path: "src/components/export-button.tsx",
		git: "A",
		agent: "created",
		additions: 22,
		size: "0.7 KB",
		modified: "now",
	},
	{
		path: "src/components/invoice-table.tsx",
		git: "M",
		agent: "edited",
		additions: 31,
		deletions: 4,
		size: "2.3 KB",
		modified: "now",
	},
	{ path: "src/components/sidebar-nav.tsx", size: "1.9 KB", modified: "4d" },
	{
		path: "src/components/ui/button.tsx",
		agent: "read",
		size: "1.6 KB",
		modified: "2w",
	},
	{ path: "src/components/ui/table.tsx", size: "2.1 KB", modified: "2w" },
	{
		path: "src/lib/csv.ts",
		git: "A",
		agent: "created",
		additions: 18,
		size: "0.6 KB",
		modified: "now",
	},
	{ path: "src/lib/db.ts", agent: "read", size: "1.3 KB", modified: "6d" },
	{
		path: "src/lib/format.ts",
		agent: "read",
		size: "0.3 KB",
		modified: "1d",
	},
	{ path: "src/styles/globals.css", size: "3.2 KB", modified: "1w" },
	{
		path: "tests/csv.test.ts",
		git: "A",
		agent: "created",
		additions: 14,
		size: "0.5 KB",
		modified: "now",
	},
	{ path: ".env.example", size: "0.2 KB", modified: "3w" },
	{ path: ".gitignore", size: "0.3 KB", modified: "3w" },
	{ path: "next.config.mjs", size: "0.4 KB", modified: "3w" },
	{ path: "package.json", size: "1.1 KB", modified: "2d" },
	{ path: "README.md", size: "1.7 KB", modified: "2d" },
	{ path: "tsconfig.json", size: "0.6 KB", modified: "3w" },
];

export const fileByPath = (path: string) =>
	FILES.find((file) => file.path === path);

export type TreeNode = {
	name: string;
	path: string;
	kind: "dir" | "file";
	children: TreeNode[];
	file?: MockFile;
};

export function buildTree(files: MockFile[] = FILES): TreeNode {
	const root: TreeNode = { name: "", path: "", kind: "dir", children: [] };
	for (const file of files) {
		const parts = file.path.split("/");
		let node = root;
		parts.forEach((part, index) => {
			const path = parts.slice(0, index + 1).join("/");
			const isFile = index === parts.length - 1;
			let child = node.children.find((c) => c.name === part);
			if (!child) {
				child = {
					name: part,
					path,
					kind: isFile ? "file" : "dir",
					children: [],
					file: isFile ? file : undefined,
				};
				node.children.push(child);
			}
			node = child;
		});
	}
	const sort = (node: TreeNode) => {
		node.children.sort((a, b) =>
			a.kind === b.kind
				? a.name.localeCompare(b.name)
				: a.kind === "dir"
					? -1
					: 1,
		);
		node.children.forEach(sort);
	};
	sort(root);
	return root;
}

/** Aggregated agent/git activity under a directory, for folder badges. */
export function dirActivity(node: TreeNode): { changed: number } {
	let changed = 0;
	const walk = (n: TreeNode) => {
		if (n.file?.git) changed++;
		n.children.forEach(walk);
	};
	walk(node);
	return { changed };
}

export const CONTENTS: Record<string, string> = {
	"src/components/invoice-table.tsx": `import { ExportButton } from "./export-button";
import { Table, TableBody, TableCell, TableHead, TableRow } from "./ui/table";
import { toCsv } from "../lib/csv";
import { formatCurrency } from "../lib/format";

export type Invoice = {
	id: string;
	customer: string;
	issuedAt: string;
	status: "paid" | "open" | "overdue";
	total: number;
};

type InvoiceTableProps = {
	invoices: Invoice[];
};

export function InvoiceTable({ invoices }: InvoiceTableProps) {
	const handleExport = () => {
		const csv = toCsv(invoices, ["id", "customer", "issuedAt", "status", "total"]);
		const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = \`invoices-\${new Date().toISOString().slice(0, 10)}.csv\`;
		link.click();
		URL.revokeObjectURL(url);
	};

	return (
		<section className="space-y-3">
			<header className="flex items-center justify-between">
				<h2 className="text-lg font-semibold">Invoices</h2>
				<ExportButton count={invoices.length} onExport={handleExport} />
			</header>
			<Table>
				<TableHead>
					<TableRow>
						<TableCell>Invoice</TableCell>
						<TableCell>Customer</TableCell>
						<TableCell>Status</TableCell>
						<TableCell align="right">Total</TableCell>
					</TableRow>
				</TableHead>
				<TableBody>
					{invoices.map((invoice) => (
						<TableRow key={invoice.id}>
							<TableCell>{invoice.id}</TableCell>
							<TableCell>{invoice.customer}</TableCell>
							<TableCell>{invoice.status}</TableCell>
							<TableCell align="right">{formatCurrency(invoice.total)}</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</section>
	);
}
`,
	"src/lib/csv.ts": `/**
 * Serialize rows to RFC 4180 CSV. Values containing commas, quotes, or
 * newlines are quoted, and embedded quotes are doubled.
 */
export function toCsv<T extends Record<string, unknown>>(
	rows: T[],
	columns: (keyof T)[],
): string {
	const escape = (value: unknown) => {
		const text = value == null ? "" : String(value);
		return /[",\\n]/.test(text) ? \`"\${text.replace(/"/g, '""')}"\` : text;
	};
	const header = columns.map((column) => escape(column)).join(",");
	const body = rows.map((row) =>
		columns.map((column) => escape(row[column])).join(","),
	);
	return [header, ...body].join("\\n");
}
`,
	"src/components/export-button.tsx": `import { Download } from "lucide-react";
import { Button } from "./ui/button";

type ExportButtonProps = {
	count: number;
	onExport: () => void;
};

export function ExportButton({ count, onExport }: ExportButtonProps) {
	return (
		<Button
			disabled={count === 0}
			onClick={onExport}
			size="sm"
			variant="outline"
		>
			<Download className="size-4" />
			Export CSV
		</Button>
	);
}
`,
	"src/lib/format.ts": `export function formatCurrency(cents: number): string {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
	}).format(cents / 100);
}
`,
	"package.json": `{
	"name": "acme-dashboard",
	"version": "0.4.0",
	"private": true,
	"scripts": {
		"dev": "next dev",
		"build": "next build",
		"test": "vitest run"
	},
	"dependencies": {
		"lucide-react": "^0.454.0",
		"next": "16.2.0",
		"react": "19.2.0",
		"react-dom": "19.2.0"
	},
	"devDependencies": {
		"typescript": "^5.9.0",
		"vitest": "^3.2.0"
	}
}
`,
};

export const README = `# Acme Dashboard

Internal billing dashboard for the Acme finance team. Built with Next.js 16, React 19, and Postgres.

## Getting started

\`\`\`bash
bun install
cp .env.example .env.local
bun dev
\`\`\`

## Project layout

- \`src/app\` – routes and API handlers
- \`src/components\` – shared UI, including the invoice table
- \`src/lib\` – data access and formatting helpers
`;

/** Lines Cline changed in invoice-table.tsx (1-based, new file). */
export const INVOICE_TABLE_CHANGED = { start: 19, end: 28 };

export const SEARCH_RESULTS = [
	"src/components/invoice-table.tsx",
	"src/app/invoices/page.tsx",
	"src/app/api/invoices/route.ts",
	"tests/csv.test.ts",
	"src/lib/csv.ts",
];
