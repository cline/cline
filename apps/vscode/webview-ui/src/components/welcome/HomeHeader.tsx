import BedrockCoderLogoVariable from "@/assets/BedrockCoderLogoVariable"
import { useExtensionState } from "@/context/ExtensionStateContext"

const HomeHeader = () => {
	const { environment } = useExtensionState()

	const headingText = "What can I do for you?"

	return (
		<div className="flex flex-col items-center mb-5">
			<div className="my-7">
				<BedrockCoderLogoVariable className="size-20" environment={environment} />
			</div>
			<div className="text-center flex items-center justify-center px-4">
				<h1 className="m-0 font-bold">{headingText}</h1>
			</div>
		</div>
	)
}

export default HomeHeader
