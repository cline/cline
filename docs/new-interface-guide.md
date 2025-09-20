# 如何在 Cline 项目中添加新的 gRPC 接口

本文档详细说明了如何在 Cline 项目中添加新的 gRPC 接口，包括定义、实现和使用新接口的完整流程。

## 1. 概述

Cline 项目使用 Protocol Buffers (protobuf) 和 gRPC 风格的通信机制来处理 WebView 和扩展后端之间的通信。所有接口都通过统一的消息处理架构进行路由和处理。

## 2. 添加新接口的步骤

### 2.1 定义 Protobuf 服务和消息类型

首先，在相应的 `.proto` 文件中定义新的服务方法和消息类型。

例如，在 `proto/cline/models.proto` 中添加：

```protobuf
// 在 service ModelsService 块中添加新的方法
rpc getSystemInfo(EmptyRequest) returns (SystemInfo);

// 在文件末尾添加新的消息类型定义
message SystemInfo {
  string platform = 1;
  string arch = 2;
  int64 total_memory = 3;
  int64 free_memory = 4;
  int32 cpu_count = 5;
  string hostname = 6;
  double uptime = 7;
}
```

### 2.2 实现服务处理器函数

创建一个新的处理器函数文件，例如 `src/core/controller/models/getSystemInfo.ts`：

```typescript
import { EmptyRequest } from "@shared/proto/cline/common"
import { SystemInfo } from "@shared/proto/cline/models"
import { Controller } from "@/core/controller"
import * as os from "os"

/**
 * Get system information
 * @param controller The controller instance
 * @param request Empty request
 * @returns System information
 */
export async function getSystemInfo(_controller: Controller, _request: EmptyRequest): Promise<SystemInfo> {
    return SystemInfo.create({
        platform: process.platform,
        arch: process.arch,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        cpuCount: os.cpus().length,
        hostname: os.hostname(),
        uptime: os.uptime(),
    })
}
```

注意：所有处理器函数必须遵循统一的函数签名：
```typescript
(controller: Controller, request: RequestType) => Promise<ResponseType>
```

### 2.3 重新生成代码

运行构建脚本来生成相应的 TypeScript 代码：

```bash
npm run protos
```

这个命令会：
1. 使用 protoc 编译器根据新的 proto 定义生成 TypeScript 代码
2. 自动生成服务处理器映射
3. 更新服务类型定义

### 2.4 验证生成结果

检查生成的文件以确认新接口已正确添加：
- `src/generated/hosts/vscode/protobus-services.ts` - 确认新函数已添加到服务处理器映射中
- `src/generated/hosts/vscode/protobus-service-types.ts` - 确认服务类型定义已更新
- `src/shared/proto/cline/models.ts` - 确认新的消息类型已生成

## 3. 使用新接口

### 3.1 在 WebView 端调用

在 WebView 的 TypeScript/JavaScript 代码中，可以通过 gRPC 客户端调用新接口：

```typescript
import { ModelsServiceClient } from '@webview/services/grpc-client'
import { EmptyRequest } from '@shared/proto/cline/common'

async function fetchSystemInfo() {
  try {
    const systemInfo = await ModelsServiceClient.getSystemInfo(EmptyRequest.create({}))
    console.log('System Info:', systemInfo)
    return systemInfo
  } catch (error) {
    console.error('Failed to fetch system info:', error)
    throw error
  }
}
```

### 3.2 在 Controller 端直接调用

在扩展的 TypeScript 代码中，可以直接调用处理器函数：

```typescript
import { getSystemInfo } from "@core/controller/models/getSystemInfo"
import { EmptyRequest } from "@shared/proto/cline/common"

// 在 Controller 中直接调用
const systemInfo = await getSystemInfo(this.controller, EmptyRequest.create({}))
```

## 4. React 组件中的使用示例

```tsx
import React, { useState } from 'react'
import { ModelsServiceClient } from '@webview/services/grpc-client'
import { EmptyRequest } from '@shared/proto/cline/common'
import type { SystemInfo } from '@shared/proto/cline/models'

const SystemInfoComponent: React.FC = () => {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchSystemInfo = async () => {
    setLoading(true)
    try {
      const info = await ModelsServiceClient.getSystemInfo(EmptyRequest.create({}))
      setSystemInfo(info)
    } catch (error) {
      console.error('Error:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button onClick={fetchSystemInfo} disabled={loading}>
        {loading ? 'Loading...' : 'Get System Info'}
      </button>
      
      {systemInfo && (
        <div>
          <p>Platform: {systemInfo.platform}</p>
          <p>Architecture: {systemInfo.arch}</p>
          <p>CPU Count: {systemInfo.cpuCount}</p>
        </div>
      )}
    </div>
  )
}

export default SystemInfoComponent
```

## 5. 注意事项

1. **命名规范**：服务方法名使用驼峰命名法，消息类型名使用驼峰命名法
2. **目录结构**：处理器函数应放在与服务名对应的目录中
3. **函数签名**：所有处理器函数必须遵循 `(controller: Controller, request: RequestType) => Promise<ResponseType>` 的签名
4. **错误处理**：处理器函数应该妥善处理异常情况
5. **64位整数**：注意 JavaScript 对 64 位整数的支持限制，必要时使用字符串表示
6. **类型安全**：充分利用 TypeScript 的类型系统确保类型安全

## 6. 调试技巧

1. 使用浏览器开发者工具检查网络请求和响应
2. 在 VS Code 调试控制台中查看扩展日志
3. 使用 `console.log` 在关键点输出调试信息
4. 检查生成的 TypeScript 代码以确保正确性

通过遵循这些步骤和规范，你可以成功地在 Cline 项目中添加和使用新的 gRPC 接口。