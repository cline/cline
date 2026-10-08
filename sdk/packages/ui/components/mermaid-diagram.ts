/**
 * Public façade for the owned Mermaid diagram block. The pure, DOM-free logic
 * is split by domain into `components/diagrams/mermaid/` and re-exported here
 * so `@cline/ui/components/mermaid-diagram` stays a stable entry point (the
 * browser glue lives in `diagrams/mermaid/dom.ts` and the React block in
 * `mermaid-block.tsx`):
 *
 * - `config`    centralized tunable values (zoom, PNG, naming, font, timing)
 * - `naming`    fence titles, slugs, frontmatter, filenames
 * - `label`     diagram type detection and label extraction
 * - `color`     CSS color parsing and conversion
 * - `theme`     design tokens and Mermaid config construction
 * - `zoom`      viewport zoom/pan math
 * - `png`       PNG export sizing and SVG raster preparation
 * - `links`     navigable-link neutralization
 * - `service`   lazy, serialized render service
 */

export {
	cssColorToHex,
	mixColors,
	parseCssColor,
	type RgbaColor,
	rgbToHex,
} from "./diagrams/mermaid/color.js";
export {
	DEFAULT_DIAGRAM_NAME,
	DIAGRAM_NAMING,
	DIAGRAM_ZOOM,
	DIAGRAM_ZOOM_STEP,
	MAX_DIAGRAM_SLUG_LENGTH,
	MAX_DIAGRAM_ZOOM,
	MERMAID_FONT,
	MERMAID_FONT_FAMILY,
	MERMAID_FONT_SIZE,
	MIN_DIAGRAM_ZOOM,
	PNG_BASE_SCALE,
	PNG_EXPORT,
	PNG_MAX_ATTEMPTS,
	PNG_MAX_DESIRED_SCALE,
	PNG_MAX_EDGE,
	PNG_MAX_ENCODED_BYTES,
	PNG_RETRY_SCALE_FACTOR,
	THEME_MIX,
	UI_TIMING,
} from "./diagrams/mermaid/config.js";

export {
	deriveDiagramLabels,
	type ResolveDiagramSlugInput,
	resolveDiagramSlug,
} from "./diagrams/mermaid/label.js";
export {
	DIAGRAM_LINK_HREF_ATTRIBUTE,
	neutralizeDiagramLinks,
} from "./diagrams/mermaid/links.js";
export {
	type DiagramFileExtension,
	diagramFileName,
	normalizeDiagramSource,
	parseFenceTitle,
	parseFrontmatterTitle,
	slugifyDiagramName,
	splitFrontmatter,
} from "./diagrams/mermaid/naming.js";
export {
	computeExportScale,
	computePngExportSize,
	encodePngWithinLimit,
	type PngExportSize,
	type PreparedSvg,
	pngFitsAttachmentLimit,
	prepareSvgForRaster,
	resolvePngDesiredScale,
} from "./diagrams/mermaid/png.js";
export {
	createMermaidService,
	defaultMermaidLoader,
	describeMermaidError,
	type LazyMermaidInstance,
	type MermaidModule,
	type MermaidModuleLoader,
	type MermaidService,
} from "./diagrams/mermaid/service.js";
export {
	buildMermaidConfig,
	buildMermaidThemeVariables,
	createDefaultMermaidConfig,
	FALLBACK_MERMAID_TOKENS,
	type MermaidColorMode,
	type MermaidColorResolver,
	type MermaidThemeOptions,
	type MermaidThemeTokens,
	type MermaidThemeVariables,
	normalizeMermaidTokens,
	resolveMermaidFontFamily,
} from "./diagrams/mermaid/theme.js";
export {
	clampDiagramZoom,
	type DiagramView,
	INITIAL_DIAGRAM_VIEW,
	stepDiagramZoom,
	wheelZoomScale,
	zoomViewAtPoint,
} from "./diagrams/mermaid/zoom.js";
