"use client"

import { SVGProps, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useHover } from "react-use"

import { cn } from "@/lib/utils"

type LogoProps = Omit<SVGProps<SVGSVGElement>, "xmlns" | "viewBox" | "onClick">

export const Logo = ({ width = 50, height = 32, fill = "#fff", className, ...props }: LogoProps) => {
	const router = useRouter()

	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width={width}
			height={height}
			viewBox="90 12 100 64"
			onClick={() => router.push("/")}
			className={cn("logo cursor-pointer", className)}
			{...props}>
			<path
				d="M171.633,15.8336l-1.7284,6.2499c-.0915.3309-.4369.5221-.7659.4239l-28.9937-8.6507c-.1928-.0575-.4016-.0167-.5586.1092l-28.7143,23.0269c-.0838.0672-.1839.1112-.2901.1276l-17.0849,2.6329c-.3163.0488-.5419.3327-.5178.6519l.0742.9817c.0237.3136.2809.5583.5953.5664l19.8448.513.2263.0063,14.6634-7.8328c.2053-.1097.455-.0936.6445.0415l10.3884,7.4053c.1629.1161.2589.3045.2571.5045l-.0876,9.826c-.0011.1272.0373.2515.11.3559l14.6133,20.9682c.1146.1644.3024.2624.5028.2624h4.626c.4615,0,.7574-.4908.542-.8989l-10.4155-19.7312c-.1019-.193-.0934-.4255.0221-.6106l5.4305-8.6994c.0591-.0947.143-.1715.2425-.222l19.415-9.8522c.1973-.1001.4332-.0861.6172.0366l5.5481,3.6981c.1007.0671.2189.1029.3399.1029h5.0407c.4881,0,.7804-.5429.5116-.9503l-13.9967-21.2171c-.2898-.4393-.962-.3331-1.1022.1741Z"
				fill={fill}
				strokeWidth="0"
			/>
		</svg>
	)
}

export const HoppingLogo = (props: LogoProps) => {
	const ref = useRef<SVGSVGElement>(null)
	const logo = <Logo ref={ref} {...props} />
	const [hoverable, hovered] = useHover(logo)

	useEffect(() => {
		const element = ref.current
		const isHopping = element !== null && element.classList.contains("animate-hop")

		if (hovered && element && !isHopping) {
			element.classList.add("animate-hop")
		} else if (element && isHopping) {
			const onAnimationEnd = () => {
				element.classList.remove("animate-hop")
				element.removeEventListener("animationiteration", onAnimationEnd)
			}

			element.addEventListener("animationiteration", onAnimationEnd)
		}
	}, [hovered])

	return hoverable
}
