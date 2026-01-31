import { Button } from "@/components/ui/button"

type ViewHeaderProps = {
	title: string
	onDone: () => void
	showEnvironmentSuffix?: boolean
	environment?: string
}

const ViewHeader = ({ title, onDone, showEnvironmentSuffix, environment }: ViewHeaderProps) => {
	const showSubtext = showEnvironmentSuffix && environment && environment !== "production"
	const capitalizedEnv = environment ? environment.charAt(0).toUpperCase() + environment.slice(1) : ""

	return (
		<div className="flex justify-between items-center py-2.5 px-5 mb-[17px]">
			<div className="relative">
				<h3 className="m-0 text-foreground text-lg font-normal">{title}</h3>
				{showSubtext && (
					<span className="absolute left-0 top-8 -translate-y-1 text-xs text-description whitespace-nowrap">
						{capitalizedEnv} environment
					</span>
				)}
			</div>
			<Button className="py-1" onClick={onDone}>
				Done
			</Button>
		</div>
	)
}

export default ViewHeader
