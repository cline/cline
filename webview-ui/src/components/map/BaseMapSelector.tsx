import React from "react"

export interface BaseMapStyle {
	id: string
	name: string
	url: string
	attribution?: string
	requiresToken?: boolean
}

/**
 * Hydrology-first basemap catalogue.
 *
 * Ordering reflects expected utility for AI-Hydro workflows:
 *   1. USGS topo + imagery + shaded relief    (water-focused, free, no token)
 *   2. Esri Hillshade + Imagery + Topo        (best CDN coverage, no token)
 *   3. Carto Light/Dark                       (clean overlay base, no token)
 *   4. Stadia terrain + OSM HOT               (alternatives if Esri/USGS unreachable)
 *   5. Restricted: OpenStreetMap.org direct   (volunteer servers — opt-in only)
 *   6. Token-gated: Mapbox styles             (require user-supplied token)
 */
export const BASE_MAP_STYLES: BaseMapStyle[] = [
	// ── Hydrology / Earth-science friendly defaults ──────────────────────────
	{
		id: "usgs-topo",
		name: "🗺️ USGS Topo",
		url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
		attribution: "USGS The National Map",
	},
	{
		id: "usgs-imagery",
		name: "🛰️ USGS Imagery",
		url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
		attribution: "USGS The National Map",
	},
	{
		id: "usgs-shaded-relief",
		name: "🏔️ USGS Shaded Relief",
		url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}",
		attribution: "USGS The National Map",
	},

	// ── Esri (global, robust, no token) ──────────────────────────────────────
	{
		id: "esri-hillshade",
		name: "⛰️ Esri Hillshade",
		url: "https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
		attribution: "© Esri — Sources: Esri, USGS, NOAA",
	},
	{
		id: "esri-imagery",
		name: "🌍 Esri World Imagery",
		url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
		attribution: "© Esri — Sources: Esri, Maxar, Earthstar Geographics, USGS",
	},
	{
		id: "esri-topo",
		name: "📐 Esri World Topo",
		url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
		attribution: "© Esri",
	},
	{
		id: "esri-ocean",
		name: "🌊 Esri Ocean",
		url: "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}",
		attribution: "© Esri — Sources: GEBCO, NOAA, Garmin",
	},

	// ── Carto (clean overlay base, OSM-derived, CDN, free for non-commercial) ──
	{
		id: "carto-light",
		name: "☀️ Carto Light",
		url: "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
		attribution: "© OpenStreetMap © CartoDB",
	},
	{
		id: "carto-dark",
		name: "🌙 Carto Dark",
		url: "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
		attribution: "© OpenStreetMap © CartoDB",
	},
	{
		id: "carto-voyager",
		name: "🧭 Carto Voyager",
		url: "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
		attribution: "© OpenStreetMap © CartoDB",
	},

	// ── Alternates / specialty ───────────────────────────────────────────────
	{
		id: "stadia-terrain",
		name: "🏞️ Stadia Terrain",
		url: "https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.jpg",
		attribution: "© Stadia Maps © Stamen Design © OpenStreetMap",
	},
	{
		id: "osm-hot",
		name: "🚑 Humanitarian OSM",
		url: "https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
		attribution: "© OpenStreetMap © HOT",
	},

	// ── Mapbox (token-gated) ─────────────────────────────────────────────────
	{ id: "mapbox-dark", name: "🌃 Mapbox Dark", url: "mapbox://styles/mapbox/dark-v10", requiresToken: true },
	{ id: "mapbox-light", name: "🏙️ Mapbox Light", url: "mapbox://styles/mapbox/light-v10", requiresToken: true },
	{ id: "mapbox-outdoors", name: "🏞️ Mapbox Outdoors", url: "mapbox://styles/mapbox/outdoors-v10", requiresToken: true },
	{ id: "mapbox-satellite", name: "🌐 Mapbox Satellite", url: "mapbox://styles/mapbox/satellite-v9", requiresToken: true },
]

interface BaseMapSelectorProps {
	currentStyle: string
	onStyleChange: (styleId: string) => void
	hasMapboxToken?: boolean
	mapStyle?: "light" | "dark"
}

/**
 * BasemapList — vertical list-style basemap picker, rendered inside the
 * MapToolRibbon panel area. Replaces the floating dropdown for a more
 * GIS-native UX (preview each basemap, group by provider, show attribution).
 */
export const BasemapList: React.FC<BaseMapSelectorProps> = ({
	currentStyle,
	onStyleChange,
	hasMapboxToken = false,
	mapStyle = "dark",
}) => {
	const availableStyles = BASE_MAP_STYLES.filter((style) => !style.url.startsWith("mapbox://") || hasMapboxToken)

	const isDark = mapStyle === "dark"
	const fg = isDark ? "var(--vscode-foreground, #ddd)" : "var(--vscode-foreground, #222)"
	const subtle = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)"
	const accent = "var(--vscode-button-background, #0e639c)"

	return (
		<div style={{ flex: 1, overflowY: "auto", padding: 4, minHeight: 0 }}>
			{availableStyles.map((style) => {
				const selected = style.id === currentStyle
				return (
					<button
						key={style.id}
						onClick={() => onStyleChange(style.id)}
						style={{
							display: "flex",
							alignItems: "center",
							gap: 8,
							width: "100%",
							padding: "6px 8px",
							marginBottom: 2,
							background: selected ? "rgba(14,99,156,0.20)" : "transparent",
							color: fg,
							border: selected ? `1px solid ${accent}` : "1px solid transparent",
							borderRadius: 3,
							cursor: "pointer",
							textAlign: "left",
							fontSize: 12,
							fontFamily: "inherit",
							lineHeight: 1.3,
						}}
						title={style.attribution ?? style.name}
						type="button">
						<span style={{ flexShrink: 0, fontSize: 14, width: 18, textAlign: "center" }}>
							{style.name.match(/^\p{Emoji}/u)?.[0] ?? "🌐"}
						</span>
						<span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
							{style.name.replace(/^\p{Emoji}\s*/u, "")}
						</span>
					</button>
				)
			})}

			{availableStyles[0]?.attribution && (
				<div
					style={{
						padding: "8px 8px 4px",
						marginTop: 6,
						borderTop: `1px solid ${subtle}`,
						fontSize: 10,
						opacity: 0.55,
						lineHeight: 1.4,
					}}>
					{availableStyles.find((s) => s.id === currentStyle)?.attribution ?? ""}
				</div>
			)}
		</div>
	)
}

/**
 * BaseMapSelector — legacy floating-dropdown variant. Kept for the in-chat
 * map tab where the ribbon is overkill. New surfaces should use BasemapList.
 */
export const BaseMapSelector: React.FC<BaseMapSelectorProps> = ({
	currentStyle,
	onStyleChange,
	hasMapboxToken = false,
	mapStyle = "dark",
}) => {
	const availableStyles = BASE_MAP_STYLES.filter((style) => !style.url.startsWith("mapbox://") || hasMapboxToken)
	const selected = availableStyles.find((s) => s.id === currentStyle)

	return (
		<div
			style={{
				position: "absolute",
				top: 10,
				right: 10,
				zIndex: 5,
				background:
					mapStyle === "dark"
						? "var(--vscode-editor-background, rgba(30,30,30,0.95))"
						: "var(--vscode-editor-background, rgba(255,255,255,0.95))",
				color: "var(--vscode-foreground, inherit)",
				borderRadius: 4,
				boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
				border: `1px solid ${mapStyle === "dark" ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.18)"}`,
				fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
			}}>
			<select
				onChange={(e) => onStyleChange(e.target.value)}
				style={{
					padding: "6px 10px",
					fontSize: 12,
					border: "none",
					borderRadius: 4,
					backgroundColor: "transparent",
					color: "inherit",
					cursor: "pointer",
					outline: "none",
					minWidth: 200,
					fontFamily: "inherit",
				}}
				title={selected?.attribution ?? "Select base map"}
				value={currentStyle}>
				{availableStyles.map((style) => (
					<option key={style.id} value={style.id}>
						{style.name}
					</option>
				))}
			</select>
		</div>
	)
}

export default BaseMapSelector
