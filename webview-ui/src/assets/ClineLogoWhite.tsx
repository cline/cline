import { SVGProps } from "react"

const EnhancedLogo = (props: SVGProps<SVGSVGElement>) => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		width="200"
		height="200"
		viewBox="0 0 100 100"
		style={{ filter: "drop-shadow(0 0 20px rgba(251, 255, 0, 0.3))" }}
		{...props}>
		<defs>
			{/* 主图形渐变 */}
			<linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
				<stop offset="0%" style={{ stopColor: "#6366f1", stopOpacity: 1 }} />
				<stop offset="100%" style={{ stopColor: "#8b5cf6", stopOpacity: 1 }} />
			</linearGradient>

			{/* 中国版本文字渐变 */}
			<linearGradient id="chinaGradient" x1="0%" y1="0%" x2="100%" y2="0%">
				<stop offset="0%" stopColor="#EE1C25" />
				<stop offset="50%" stopColor="#FFFFFF" />
				<stop offset="100%" stopColor="#EE1C25" />
				<animate attributeName="x1" values="0%;100%;0%" dur="5s" repeatCount="indefinite" />
			</linearGradient>

			<path
				id="originalPath"
				d="m16.5,96H0c0-32,0-64,0-96,32,0,64,0,96,0v96c-4.5,0-9,0-13.5,0-1.01-2.83-2.74-5.12-2.61-8.72.12-3.17-2.58-6.76-4.76-9.61-2.29-2.99-4.48-6.95-9.6-5.67-.58.14-2.15-1.04-2.08-1.38.72-3.78-2.15-3.97-4.91-4.93,7.05-3.24,12.34-8.04,15.31-15.01,6.39,3.74,9.74,3.86,13.43.79,6.44-5.38,1.86-10.43-.72-15.38,3.87-2.37,5.72-5.88,4.75-8.66-2.26-6.47-3.29-7.24-8.27-6.83-.93-2.48-1.29-5.17-2.81-6.78-.82-.87-3.7-.17-5.47.38-.94.29-1.49,1.81-2.27,2.73-1.9,2.23-3,5.41-6.52,5.73-.16,1.15-.33,2.44-.51,3.73l-.16.16c-.92-.4-2.06-.57-2.74-1.22-8.57-8.26-23.4-5.47-28.66,5.22-.89,1.81-3.28,2.89-4.97,4.3-.1-2.2-.88-4.67-.14-6.54,1.19-3.01,3.39-5.62,5.2-8.47-2.02,1.47-3.99,2.91-6.28,4.57-1.54-2.01-3.03-3.68-4.2-5.55-1.84-2.93-4.43-3.95-7.67-3.39-4.61.8-6.38,4.81-7.85,8.32-.69,1.64,1.11,4.33,1.78,6.55.49.21.98.42,1.47.62-1.57,1.2-3.27,2.27-4.69,3.63-3.31,3.18-3.38,5.68-.12,8.98,1.46,1.47,3.39,2.48,5.32,3.86-.91,1.39-2.83,3.08-2.92,4.85-.08,1.75,1.35,3.99,2.78,5.27,1.24,1.1,3.66,1.94,5.12,1.48,2.9-.9,5.49-2.78,7.88-4.07,4.34,3.47,9.06,7.24,14,11.19-2.48.08-4.56.73-3.83,4.07.09.41-1.87,1.57-3.02,1.87-2,.53-4.1.66-6.18.96.64,3.07-3.12,8.18-4.88,8.18-.24,1.3-.33,2.45-.66,3.53-1.14,3.76-2.35,7.49-3.54,11.23Z"
			/>
		</defs>

		{/* 主图形动画 */}
		<g transform="translate(0, 0)">
			<use href="#originalPath" fill="url(#grad1)">
				<animate attributeName="opacity" values="1;0.8;1" dur="3s" repeatCount="indefinite" />
			</use>

			<use href="#originalPath" fill="none" stroke="#ffffff" strokeWidth="0.5">
				<animateTransform
					attributeName="transform"
					type="rotate" // 旋转动画
					from="0 50 50" // 旋转中心
					to="360 50 50" // 旋转中心
					dur="0.5s" // 旋转速度加速
					repeatCount="indefinite"
				/>
			</use>
		</g>

		{/* 中国版本文字 */}
		<text
			x="50%" // 文字水平居中（基于父容器宽度50%位置）
			y="88" // 文字垂直位置（距顶部92像素）
			textAnchor="middle" // 文字锚点居中（使文字以x坐标为中心对称显示）
			fill="url(#chinaGradient)" // 使用ID为chinaGradient的渐变填充文字颜色
			style={{
				fontSize: "16px", // 字体大小16像素
				fontWeight: "900", // 加粗程度（最粗）
				letterSpacing: "0.5em", // 字母间距（0.5个字体宽度）
				paintOrder: "stroke", // 先绘制描边后填充（确保描边可见）
				stroke: "#A50021", // 描边颜色（深红色）
				strokeWidth: "0.5px", // 描边宽度0.5像素
				fontFamily: "microsoft yahei, SimHei, sans-serif", // 字体栈
				textShadow: "0 0 10px rgba(165,0,33,0.5)", // 红色阴影（X偏移0, Y偏移0, 模糊10px, 半透明红）
			}}>
			中国版本
			{/* 呼吸动画效果 */}
			<animateTransform
				attributeName="transform" // 动画作用于transform属性
				type="scale" // 缩放动画
				values="1;1.1;1" // 缩放值从1 → 1.1 → 1
				keyTimes="0;0.5;1" // 关键帧时间分配（0%/50%/100%）
				dur="1.8s" // 动画周期1.8秒
				repeatCount="indefinite" // 无限循环
			/>
			{/* 透明度动画 */}
			<animate attributeName="opacity" values="0.9;1;0.9" dur="2.5s" repeatCount="indefinite" />
		</text>
	</svg>
)

export default EnhancedLogo
