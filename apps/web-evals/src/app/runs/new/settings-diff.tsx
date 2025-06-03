import { Fragment, HTMLAttributes } from "react"

import { type Keys, type RooCodeSettings, GLOBAL_SETTINGS_KEYS, PROVIDER_SETTINGS_KEYS } from "@roo-code/types"

import { cn } from "@/lib/utils"

export const ROO_CODE_SETTINGS_KEYS = [...GLOBAL_SETTINGS_KEYS, ...PROVIDER_SETTINGS_KEYS] as Keys<RooCodeSettings>[]

type SettingsDiffProps = HTMLAttributes<HTMLDivElement> & {
	defaultSettings: RooCodeSettings
	customSettings: RooCodeSettings
}

export function SettingsDiff({
	customSettings: { experiments: customExperiments, ...customSettings },
	defaultSettings: { experiments: defaultExperiments, ...defaultSettings },
	className,
	...props
}: SettingsDiffProps) {
	const defaults = { ...defaultSettings, ...defaultExperiments }
	const custom = { ...customSettings, ...customExperiments }

	return (
		<div className={cn("grid grid-cols-3 gap-2 text-sm p-2", className)} {...props}>
			<div className="font-medium text-muted-foreground">Setting</div>
			<div className="font-medium text-muted-foreground">Default</div>
			<div className="font-medium text-muted-foreground">Custom</div>
			{ROO_CODE_SETTINGS_KEYS.map((key) => {
				const defaultValue = defaults[key as keyof typeof defaults]
				const customValue = custom[key as keyof typeof custom]
				const isDefault = JSON.stringify(defaultValue) === JSON.stringify(customValue)

				return isDefault ? null : (
					<SettingDiff
						key={key}
						name={key}
						defaultValue={JSON.stringify(defaultValue, null, 2)}
						customValue={JSON.stringify(customValue, null, 2)}
					/>
				)
			})}
		</div>
	)
}

type SettingDiffProps = HTMLAttributes<HTMLDivElement> & {
	name: string
	defaultValue?: string
	customValue?: string
}

export function SettingDiff({ name, defaultValue, customValue, ...props }: SettingDiffProps) {
	return (
		<Fragment {...props}>
			<div className="overflow-hidden font-mono" title={name}>
				{name}
			</div>
			<pre className="overflow-hidden inline text-rose-500 line-through" title={defaultValue}>
				{defaultValue}
			</pre>
			<pre className="overflow-hidden inline text-teal-500" title={customValue}>
				{customValue}
			</pre>
		</Fragment>
	)
}
