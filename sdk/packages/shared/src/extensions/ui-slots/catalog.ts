import { PLUGIN_UI_SLOTS, type PluginUiSlot } from "./constants";

/** A declared catalog (wire data): the string entries that are in PLUGIN_UI_SLOTS, deduped, in catalog order. Anything else gives []. Never throws. */
export function readPluginUiSlotCatalog(value: unknown): PluginUiSlot[] {
	if (!Array.isArray(value)) return [];
	return PLUGIN_UI_SLOTS.filter((slot) => value.includes(slot));
}
