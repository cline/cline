/** Customize's two views: what is installed, and what could be. */
export type CustomizeSection = "manage" | "browse";

export const CUSTOMIZATION_SECTION_LABELS: Record<CustomizeSection, string> = {
	manage: "Manage",
	browse: "Browse",
};
