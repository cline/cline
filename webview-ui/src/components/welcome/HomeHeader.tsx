import { useFirebaseAuth } from "@/context/FirebaseAuthContext"
import ClineLogoWhite from "@/assets/ClineLogoWhite"

const getTimeOfDay = () => {
	const hour = new Date().getHours()

	if (hour >= 5 && hour < 12) return "Morning"
	if (hour >= 12 && hour < 18) return "Afternoon"
	if (hour >= 18 && hour < 24) return "Evening"
	return "Late Night"
}

const getSecondaryMessage = (timeOfDay: string) => {
	switch (timeOfDay) {
		case "Morning":
			return "Grab coffee and let's get to work."
		case "Afternoon":
			return "Let's keep the momentum going."
		case "Evening":
			return "Still going strong!"
		case "Late Night":
			return "Burning the midnight oil?"
		default:
			return "Let's get to work."
	}
}

const getFirstName = (displayName: string | null | undefined) => {
	if (!displayName) return ""
	return displayName.split(" ")[0]
}

const HomeHeader = () => {
	const { user } = useFirebaseAuth()
	const timeOfDay = getTimeOfDay()
	const firstName = getFirstName(user?.displayName)

	return (
		<div className="flex flex-col items-center mb-5">
			<div className="my-5">
				<ClineLogoWhite className="size-16" />
			</div>
			<div className="text-center">
				<h2 className="m-0 text-[var(--vscode-font-size)]">
					{timeOfDay}
					{firstName ? ` ${firstName}` : ""}!
				</h2>
				<div className="text-[var(--vscode-descriptionForeground)] text-sm font-normal mt-1">
					{getSecondaryMessage(timeOfDay)}
				</div>
			</div>
		</div>
	)
}

export default HomeHeader
