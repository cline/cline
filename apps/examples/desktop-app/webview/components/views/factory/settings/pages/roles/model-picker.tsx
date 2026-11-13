"use client";

import type { FactoryAgent } from "@cline/shared/browser";
import { factoryShortModel } from "@/lib/factory-copy";
import { FS_ROLES } from "@/lib/factory-settings-copy/roles";
import { ModelSelector } from "../../../../chat/chat-input-bar";

const noop = () => {};

type ModelSelection = NonNullable<FactoryAgent["modelSelection"]>;

/**
 * A model: the app's own model picker in its compact form. The full model id
 * is the title; without a selection it reads "Default model". A change saves
 * at once (the caller commits it).
 */
export function ModelPicker({
	label,
	selection,
	disabled,
	onChange,
}: {
	label: string;
	selection: ModelSelection | undefined;
	disabled: boolean;
	onChange: (selection: ModelSelection) => void;
}) {
	return (
		<fieldset
			aria-label={label}
			title={
				selection
					? `${selection.providerId}/${selection.modelId}`
					: FS_ROLES.defaultModel
			}
			data-model={selection ? factoryShortModel(selection.modelId) : ""}
			className="flex min-w-0 items-center rounded-md border"
		>
			<ModelSelector
				provider={selection?.providerId ?? ""}
				model={selection?.modelId ?? ""}
				isBusy={disabled}
				autoCorrectModel={false}
				persistSelection={false}
				onProviderChange={noop}
				onModelChange={noop}
				onSelectionChange={onChange}
				onModelReadyChange={noop}
				onModelSupportsReasoningChange={noop}
				onModelSupportsImagesChange={noop}
				compactLabel={
					selection
						? factoryShortModel(selection.modelId)
						: FS_ROLES.defaultModel
				}
			/>
		</fieldset>
	);
}
