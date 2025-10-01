import type { TelemetryProperties } from "../providers/ITelemetryProvider"
import type { TelemetryService } from "../TelemetryService"
import { EventHandlerBase } from "./EventHandlerBase"

/**
 * Property types for UI telemetry events
 */

export interface ModelSelectedProperties extends TelemetryProperties {
	model: string
	provider: string
	ulid?: string
}

export interface ModelFavoriteToggledProperties extends TelemetryProperties {
	model: string
	isFavorited: boolean
}

export interface ButtonClickedProperties extends TelemetryProperties {
	button: string
	ulid?: string
}

/**
 * Event handler for UI-related telemetry events
 */
export class UIEvents extends EventHandlerBase {
	static override readonly prefix = "ui"

	/**
	 * Records when a different model is selected for use
	 * @param service The telemetry service instance
	 * @param model Name of the selected model
	 * @param provider Provider of the selected model
	 * @param ulid Optional task identifier if model was selected during a task
	 */
	static captureModelSelected(service: TelemetryService, model: string, provider: string, ulid?: string): void {
		const properties: ModelSelectedProperties = {
			model,
			provider,
			ulid,
		}
		UIEvents.capture(service, "ui.model_selected", properties)
	}

	/**
	 * Records when the user uses the model favorite button in the model picker
	 * @param service The telemetry service instance
	 * @param model The name of the model the user has interacted with
	 * @param isFavorited Whether the model is being favorited (true) or unfavorited (false)
	 */
	static captureModelFavoritesUsage(service: TelemetryService, model: string, isFavorited: boolean): void {
		const properties: ModelFavoriteToggledProperties = {
			model,
			isFavorited,
		}
		UIEvents.capture(service, "ui.model_favorite_toggled", properties)
	}

	/**
	 * Records when a button is clicked
	 * @param service The telemetry service instance
	 * @param button The button identifier
	 * @param ulid Optional task identifier
	 */
	static captureButtonClick(service: TelemetryService, button: string, ulid?: string): void {
		const properties: ButtonClickedProperties = {
			button,
			ulid,
		}
		UIEvents.capture(service, "ui.button_clicked", properties)
	}

	/**
	 * Records when the rules menu button is clicked to open the rules/workflows modal
	 * @param service The telemetry service instance
	 */
	static captureRulesMenuOpened(service: TelemetryService): void {
		UIEvents.capture(service, "ui.rules_menu_opened", {})
	}
}
