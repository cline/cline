import { Fragment, HTMLAttributes } from "react"

import { RooCodeSettings } from "@evals/types"

import { cn } from "@/lib/utils"

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
			{Object.entries(defaults).flatMap(([key, defaultValue]) => {
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
			<div className="overflow-hidden font-mono">{name}</div>
			<pre className="inline text-rose-500 line-through">{defaultValue}</pre>
			<pre className="inline text-teal-500">{customValue}</pre>
		</Fragment>
	)
}
