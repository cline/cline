import { useFirebaseAuth } from "@/context/FirebaseAuthContext"
import ClineLogoWhite from "@/assets/ClineLogoWhite"

type TimeOfDay = "morning" | "afternoon" | "evening" | "night"

const getTimeOfDay = (): TimeOfDay => {
	const hour = new Date().getHours()

	if (hour >= 5 && hour < 12) return "morning"
	if (hour >= 12 && hour < 18) return "afternoon"
	if (hour >= 18 && hour < 24) return "evening"
	return "night"
}

const secondaryMessages: Record<TimeOfDay, string[]> = {
	morning: ["Grab coffee and let's get to work."],
	afternoon: ["Let's keep the momentum going."],
	evening: ["Still going strong!"],
	night: ["Burning the midnight oil?"],
}
const defaultSecondaryMessages = ["Let's get to work."]

const primaryGreetings: Record<TimeOfDay, string[]> = {
	morning: ["Good Morning"],
	afternoon: ["Good Afternoon"],
	evening: ["Good Evening"],
	night: ["Good Night"],
}
const defaultPrimaryGreetings = ["Hello"]

const getSecondaryMessage = (timeOfDay: TimeOfDay): string => {
	const messages = secondaryMessages[timeOfDay] || defaultSecondaryMessages
	const randomIndex = Math.floor(Math.random() * messages.length)
	return messages[randomIndex]
}

const getPrimaryGreeting = (timeOfDay: TimeOfDay): string => {
	const greetings = primaryGreetings[timeOfDay] || defaultPrimaryGreetings
	const randomIndex = Math.floor(Math.random() * greetings.length)
	return greetings[randomIndex]
}

const getFirstName = (displayName: string | null | undefined) => {
	if (!displayName) return ""
	return displayName.split(" ")[0]
}

const HomeHeader = () => {
	const { user } = useFirebaseAuth()
	const timeOfDay = getTimeOfDay()
	const firstName = getFirstName(user?.displayName)
	const greeting = getPrimaryGreeting(timeOfDay)

	return (
		<div className="flex flex-col items-center mb-5">
			<div className="my-5">
				<ClineLogoWhite className="size-16" />
			</div>
			<div className="text-center">
				<h2 className="m-0 text-[var(--vscode-font-size)]">
					{greeting}
					{firstName ? `, ${firstName}` : ""}!
				</h2>
				<div className="text-[var(--vscode-descriptionForeground)] text-sm font-normal mt-1">
					{getSecondaryMessage(timeOfDay)}
				</div>
			</div>
		</div>
	)
}

export default HomeHeader
