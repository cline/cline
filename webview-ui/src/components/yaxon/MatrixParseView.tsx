import { ArrowLeftOutlined, CodeOutlined } from "@ant-design/icons"
import { Button, Card, Space, Typography } from "antd"
import React from "react"

const { Title, Text } = Typography

interface MatrixParseViewProps {
	onBack?: () => void
}

const MatrixParseView: React.FC<MatrixParseViewProps> = ({ onBack }) => {
	return (
		<div style={{ padding: "20px", height: "100%", display: "flex", flexDirection: "column" }}>
			<Card
				bodyStyle={{
					flex: 1,
					overflow: "auto",
					backgroundColor: "var(--vscode-sideBar-background)",
				}}
				style={{
					height: "100%",
					display: "flex",
					flexDirection: "column",
					backgroundColor: "var(--vscode-sideBar-background)",
					borderColor: "var(--vscode-panel-border)",
				}}>
				<Space direction="vertical" size="large" style={{ width: "100%" }}>
					<div>
						{onBack && (
							<Button
								icon={<ArrowLeftOutlined />}
								onClick={onBack}
								style={{
									marginBottom: "12px",
									color: "var(--vscode-textLink-foreground)",
								}}
								type="text">
								返回菜单
							</Button>
						)}
						<Title
							level={3}
							style={{
								color: "var(--vscode-foreground)",
								display: "flex",
								alignItems: "center",
								gap: "8px",
							}}>
							<CodeOutlined />
							矩阵报文解析
						</Title>
						<Text style={{ color: "var(--vscode-descriptionForeground)" }}>矩阵文件解析与CAN报文分析工具</Text>
					</div>

					<div
						style={{
							backgroundColor: "var(--vscode-editor-background)",
							padding: "16px",
							borderRadius: "4px",
							border: "1px solid var(--vscode-panel-border)",
						}}>
						<Text style={{ color: "var(--vscode-foreground)" }}>
							在这里将实现矩阵报文解析功能：
							<ul style={{ color: "var(--vscode-foreground)", marginTop: "8px", paddingLeft: "20px" }}>
								<li>上传矩阵文件（.xlsx, .xls, .csv）</li>
								<li>解析CAN报文格式</li>
								<li>显示信号值和对应关系</li>
								<li>导出解析结果</li>
							</ul>
						</Text>
					</div>
				</Space>
			</Card>
		</div>
	)
}

export default MatrixParseView
