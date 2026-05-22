/**
 * AI-Hydro Connectors — shared types and the built-in connector registry.
 *
 * A "connector" is a configured link from AI-Hydro to an external data source or
 * compute service (Google Earth Engine, USGS NWIS, HydroShare, etc.). Connectors
 * live in their own top-level UI panel, not in the map toolbar or the MCP panel.
 *
 * v1 ships with a static registry. A future v2 may merge with a GitHub-hosted
 * catalog at https://ai-hydro.github.io/Connectors/api/connectors.json.
 *
 * Security contract:
 *   - The webview only ever sees status + metadata, never credentials.
 *   - Tokens/keys live in vscode.SecretStorage under keys
 *     `aihydro.connectors.<connectorId>.<secretName>`.
 *   - Status (connected / disconnected) is cached in global state under
 *     `aihydro.connectors.status`, keyed by connectorId.
 */

export type ConnectorStatus = "connected" | "disconnected" | "error" | "unknown" | "coming-soon"

export type ConnectorAuthType = "oauth" | "api-key" | "service-account" | "none"

export type ConnectorActionId = "connect" | "test" | "configure" | "docs" | "disconnect"

export interface ConnectorAction {
	id: ConnectorActionId
	label: string
	/** VS Code command ID to invoke. May not be registered yet; the UI handles that. */
	commandId?: string
	primary?: boolean
}

export interface ConnectorDefinition {
	id: string
	displayName: string
	description: string
	category: string
	/** Codicon name (without `$()`), or short emoji for the catalog tile. */
	icon: string
	authType: ConnectorAuthType
	tags: string[]
	docsUrl?: string
	comingSoon: boolean
	actions: ConnectorAction[]
}

export interface ConnectorStatusEntry {
	status: ConnectorStatus
	lastChecked?: string
	error?: string
}

export type ConnectorStatusMap = Record<string, ConnectorStatusEntry>

export const CONNECTOR_STATUS_STATE_KEY = "aihydro.connectors.status"

export function secretStorageKey(connectorId: string, secretName: string): string {
	return `aihydro.connectors.${connectorId}.${secretName}`
}

// ----------------------------------------------------------------------------
// Built-in connector registry
// ----------------------------------------------------------------------------

const docs = {
	gee: "https://developers.google.com/earth-engine",
	hawqs: "https://hawqs.tamu.edu/",
	nwis: "https://waterdata.usgs.gov/nwis",
	hydroshare: "https://www.hydroshare.org/",
	planetary: "https://planetarycomputer.microsoft.com/",
	opentopo: "https://opentopography.org/",
	earthdata: "https://www.earthdata.nasa.gov/",
}

/**
 * The seven initial connectors. GEE has action entries pointing at command IDs
 * that may or may not be registered yet; the UI disables buttons whose commands
 * don't exist. The other six are marked `comingSoon: true` and render as
 * read-only previews.
 */
export const BUILTIN_CONNECTORS: ConnectorDefinition[] = [
	{
		id: "google_earth_engine",
		displayName: "Google Earth Engine",
		description:
			"Cloud-scale geospatial analysis with the GEE Python API. Authenticate once and query rasters, image collections, and feature collections from MCP tools.",
		category: "remote-sensing",
		icon: "globe",
		authType: "oauth",
		tags: ["raster", "satellite", "remote-sensing", "cloud-compute"],
		docsUrl: docs.gee,
		comingSoon: false,
		actions: [
			{ id: "connect", label: "Connect", commandId: "aihydro.gee.connect", primary: true },
			{ id: "test", label: "Test", commandId: "aihydro.gee.test" },
			{ id: "configure", label: "Configure Project", commandId: "aihydro.gee.chooseProject" },
			{ id: "docs", label: "Docs ↗" },
			{ id: "disconnect", label: "Disconnect", commandId: "aihydro.gee.disconnect" },
		],
	},
	{
		id: "hawqs",
		displayName: "HAWQS",
		description:
			"Hydrologic and Water Quality System. Run SWAT-based simulations in the cloud for any 12-digit HUC in the US.",
		category: "modelling",
		icon: "beaker",
		authType: "api-key",
		tags: ["SWAT", "water-quality", "modelling", "HUC12"],
		docsUrl: docs.hawqs,
		comingSoon: true,
		actions: [],
	},
	{
		id: "usgs_nwis",
		displayName: "USGS / NWIS",
		description:
			"National Water Information System — real-time and historical streamflow, groundwater, and water-quality observations across the United States.",
		category: "data-access",
		icon: "pulse",
		authType: "none",
		tags: ["streamflow", "groundwater", "USA", "real-time"],
		docsUrl: docs.nwis,
		comingSoon: true,
		actions: [],
	},
	{
		id: "hydroshare",
		displayName: "HydroShare",
		description:
			"Open community platform for sharing hydrologic data and models. Pull resources, publish your AI-Hydro outputs back as citable artifacts.",
		category: "data-access",
		icon: "cloud",
		authType: "oauth",
		tags: ["data-sharing", "citation", "FAIR", "CUAHSI"],
		docsUrl: docs.hydroshare,
		comingSoon: true,
		actions: [],
	},
	{
		id: "planetary_computer",
		displayName: "Microsoft Planetary Computer",
		description:
			"STAC-indexed petabytes of environmental data — Landsat, Sentinel, NAIP, DEMs, ERA5 — with a hosted Dask compute backend.",
		category: "remote-sensing",
		icon: "milestone",
		authType: "api-key",
		tags: ["STAC", "Landsat", "Sentinel", "Dask", "raster"],
		docsUrl: docs.planetary,
		comingSoon: true,
		actions: [],
	},
	{
		id: "opentopography",
		displayName: "OpenTopography",
		description:
			"High-resolution topographic data — global DEMs (SRTM, ALOS, COP), regional lidar point clouds, and on-demand processing.",
		category: "data-access",
		icon: "graph-line",
		authType: "api-key",
		tags: ["DEM", "lidar", "topography", "terrain"],
		docsUrl: docs.opentopo,
		comingSoon: true,
		actions: [],
	},
	{
		id: "nasa_earthdata",
		displayName: "NASA Earthdata",
		description:
			"Unified search and access to NASA's Earth observation archive — MODIS, GPM, SMAP, ICESat-2, and many more datasets via DAAC.",
		category: "data-access",
		icon: "rocket",
		authType: "oauth",
		tags: ["NASA", "MODIS", "GPM", "SMAP", "satellite"],
		docsUrl: docs.earthdata,
		comingSoon: true,
		actions: [],
	},
]

export function getConnectorById(id: string): ConnectorDefinition | undefined {
	return BUILTIN_CONNECTORS.find((c) => c.id === id)
}
