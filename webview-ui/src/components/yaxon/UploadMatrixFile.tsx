import { UploadOutlined } from "@ant-design/icons"
import { Button, Card, message, Space, Typography, Upload, UploadProps } from "antd"
import React from "react"

const { Title, Text } = Typography

interface UploadMatrixFileProps {
	onFileUpload: (file: File) => void
	isProcessing: boolean
}

const UploadMatrixFile: React.FC<UploadMatrixFileProps> = ({ onFileUpload, isProcessing }) => {
	const [fileList, setFileList] = React.useState<any[]>([])

	const uploadProps: UploadProps = {
		beforeUpload: (file) => {
			const isAllowedType =
				file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || // .xlsx
				file.type === "application/vnd.ms-excel" || // .xls
				file.type === "text/csv" || // .csv
				file.name.endsWith(".xlsx") ||
				file.name.endsWith(".xls") ||
				file.name.endsWith(".csv")

			if (!isAllowedType) {
				message.error("只能上传 Excel (.xlsx, .xls) 或 CSV (.csv) 文件!")
				return false
			}

			setFileList([file])
			onFileUpload(file)
			return false // 阻止自动上传
		},
		fileList,
		maxCount: 1,
		disabled: isProcessing,
		onRemove: () => {
			setFileList([])
		},
	}

	return (
		<Card
			bodyStyle={{
				backgroundColor: "var(--vscode-sideBar-background)",
			}}
			style={{
				backgroundColor: "var(--vscode-sideBar-background)",
				borderColor: "var(--vscode-panel-border)",
			}}>
			<Space direction="vertical" size="large" style={{ width: "100%" }}>
				<div>
					<Title
						level={4}
						style={{
							color: "var(--vscode-foreground)",
							marginTop: 0,
							marginBottom: "16px",
						}}>
						上传CAN功能矩阵定义文件
					</Title>
					<Text style={{ color: "var(--vscode-descriptionForeground)" }}>
						请上传厂商提供的CAN功能矩阵定义文件，支持格式：.xlsx, .xls, .csv
					</Text>
				</div>

				<div>
					<Upload.Dragger {...uploadProps}>
						<p className="ant-upload-drag-icon">
							<UploadOutlined style={{ color: "var(--vscode-textLink-foreground)" }} />
						</p>
						<p className="ant-upload-text" style={{ color: "var(--vscode-foreground)" }}>
							点击或拖拽文件到此区域上传
						</p>
						<p className="ant-upload-hint" style={{ color: "var(--vscode-descriptionForeground)" }}>
							支持单个文件上传，格式：.xlsx, .xls, .csv
						</p>
					</Upload.Dragger>
				</div>

				<div
					style={{
						backgroundColor: "var(--vscode-editor-background)",
						padding: "16px",
						borderRadius: "4px",
						border: "1px solid var(--vscode-panel-border)",
					}}>
					<Text strong style={{ color: "var(--vscode-foreground)", display: "block", marginBottom: "8px" }}>
						处理流程说明：
					</Text>
					<ul style={{ color: "var(--vscode-foreground)", paddingLeft: "20px", marginBottom: 0 }}>
						<li>1. 上传厂商定义的CAN功能矩阵文件</li>
						<li>2. 调用MCP Server将文件转换为标准DBC文件</li>
						<li>3. 验证DBC文件内容有效性</li>
						<li>4. 询问是否将DBC文件转换为C/Java代码</li>
						<li>5. 生成符合编码规范的代码文件</li>
						<li>6. 语法检查并输出到项目目录</li>
					</ul>
				</div>
			</Space>
		</Card>
	)
}

export default UploadMatrixFile
