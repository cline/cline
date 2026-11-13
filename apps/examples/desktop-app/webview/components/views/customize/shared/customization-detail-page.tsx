import { DetailPage, type DetailPageProps } from "../../shared/detail-page";

/** Customize keeps its title and navigation label in the shared detail shell. */
export function CustomizationDetailPage({
	navigationLabel = "Customization navigation",
	...props
}: Omit<DetailPageProps, "title">) {
	return (
		<DetailPage
			{...props}
			title="Customize"
			navigationLabel={navigationLabel}
		/>
	);
}
