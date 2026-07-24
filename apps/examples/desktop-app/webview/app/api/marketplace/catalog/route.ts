const MARKETPLACE_CATALOG_URL =
	process.env.CLINE_MARKETPLACE_CATALOG_URL?.trim() ||
	"https://cline.github.io/marketplace/catalog.json";

export const dynamic = "force-static";

const EMPTY_MARKETPLACE_CATALOG = {
	version: 1,
	counts: {
		total: 0,
		plugins: 0,
		skills: 0,
		mcps: 0,
	},
	tags: [],
	entries: [],
};

export async function GET() {
	try {
		const response = await fetch(MARKETPLACE_CATALOG_URL, {
			headers: { Accept: "application/json" },
		});
		if (!response.ok) {
			return Response.json({
				...EMPTY_MARKETPLACE_CATALOG,
				error:
					`Failed to fetch marketplace catalog: ${response.status} ${response.statusText}`.trim(),
			});
		}
		return Response.json(await response.json());
	} catch (error) {
		return Response.json({
			...EMPTY_MARKETPLACE_CATALOG,
			error:
				error instanceof Error
					? error.message
					: "Failed to fetch marketplace catalog",
		});
	}
}
