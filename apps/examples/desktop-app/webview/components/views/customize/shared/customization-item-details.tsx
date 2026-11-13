import { cn } from "@/lib/utils";
import { ItemDetails, type ItemDetailsProps } from "../../shared/item-details";
import { CustomizationCategorySection } from "./customization-category-section";
import styles from "./customization-item-details.module.css";

/** Customize supplies category navigation to the shared detail content layout. */
export function CustomizationItemDetails({
	header,
	categories,
	tagLabels,
	onSelectCategory,
	onCategorySelected,
	categoryNavigationDisabled = false,
	...props
}: Omit<ItemDetailsProps, "renderHeader" | "aside" | "className"> & {
	header: ItemDetailsProps["renderHeader"];
	categories: readonly string[];
	tagLabels?: Map<string, string>;
	onSelectCategory?: (category: string) => void;
	onCategorySelected?: () => void;
	categoryNavigationDisabled?: boolean;
}) {
	return (
		<ItemDetails
			{...props}
			renderHeader={header}
			aside={
				categories.length > 0 ? (
					<fieldset disabled={categoryNavigationDisabled} className="min-w-0">
						<CustomizationCategorySection
							categories={categories}
							className={cn(styles.categories, styles.page)}
							onSelectCategory={onSelectCategory}
							onSelected={onCategorySelected}
							tagLabels={tagLabels}
						/>
					</fieldset>
				) : null
			}
		/>
	);
}
