// Guards the public façade export surface: the flat constants that predate the
// grouped config objects must stay importable from `components/mermaid-diagram`
// and stay equal to the grouped values (the single source of truth).

import { describe, expect, test } from "vitest";
import {
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
} from "../../../components/mermaid-diagram";

describe("mermaid-diagram façade", () => {
	test("keeps exporting the pre-grouping flat constants", () => {
		expect(DEFAULT_DIAGRAM_NAME).toBe(DIAGRAM_NAMING.defaultName);
		expect(MAX_DIAGRAM_SLUG_LENGTH).toBe(DIAGRAM_NAMING.maxSlugLength);
		expect(MERMAID_FONT_FAMILY).toBe(MERMAID_FONT.family);
		expect(MERMAID_FONT_SIZE).toBe(MERMAID_FONT.size);
		expect(MIN_DIAGRAM_ZOOM).toBe(DIAGRAM_ZOOM.min);
		expect(MAX_DIAGRAM_ZOOM).toBe(DIAGRAM_ZOOM.max);
		expect(DIAGRAM_ZOOM_STEP).toBe(DIAGRAM_ZOOM.step);
		expect(PNG_MAX_EDGE).toBe(PNG_EXPORT.maxEdge);
		expect(PNG_BASE_SCALE).toBe(PNG_EXPORT.baseScale);
		expect(PNG_MAX_DESIRED_SCALE).toBe(PNG_EXPORT.maxDesiredScale);
		expect(PNG_MAX_ENCODED_BYTES).toBe(PNG_EXPORT.maxEncodedBytes);
		expect(PNG_RETRY_SCALE_FACTOR).toBe(PNG_EXPORT.retryScaleFactor);
		expect(PNG_MAX_ATTEMPTS).toBe(PNG_EXPORT.attemptLimit);
	});
});
