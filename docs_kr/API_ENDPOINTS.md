# API Endpoints Configuration

## 개요

모든 API 프로바이더의 기본 URL과 엔드포인트를 중앙에서 관리하는 시스템입니다.

## 파일 위치

- **설정 파일**: `/src/shared/api-endpoints.ts`
- **사용 예시**: `/src/core/api/providers/anthropic.ts`

## 주요 기능

### 1. 중앙화된 엔드포인트 관리

모든 API 프로바이더의 기본 URL을 한 곳에서 관리합니다:

```typescript
export const API_ENDPOINTS = {
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    description: "Anthropic Claude API",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    description: "OpenAI API",
  },
  // ... 기타 프로바이더
}
```

### 2. 지역별 엔드포인트 지원

일부 프로바이더는 지역별로 다른 엔드포인트를 사용합니다:

```typescript
qwen: {
  international: {
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    description: "Qwen International API",
  },
  china: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    description: "Qwen China API",
  },
}
```

### 3. 헬퍼 함수

#### getDefaultBaseUrl()

프로바이더의 기본 URL을 가져옵니다:

```typescript
import { getDefaultBaseUrl } from '@shared/api-endpoints'

// 단일 엔드포인트
const anthropicUrl = getDefaultBaseUrl('anthropic')
// 결과: "https://api.anthropic.com"

// 지역별 엔드포인트
const qwenUrl = getDefaultBaseUrl('qwen', 'china')
// 결과: "https://dashscope.aliyuncs.com/compatible-mode/v1"
```

#### getEndpointDescription()

프로바이더의 설명을 가져옵니다:

```typescript
import { getEndpointDescription } from '@shared/api-endpoints'

const description = getEndpointDescription('anthropic')
// 결과: "Anthropic Claude API"
```

## 프로바이더에서 사용하기

각 API 프로바이더 핸들러에서 다음과 같이 사용합니다:

```typescript
import { getDefaultBaseUrl } from '@shared/api-endpoints'

export class AnthropicHandler implements ApiHandler {
  private ensureClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({
        apiKey: this.options.apiKey,
        // 사용자 설정이 없으면 기본 URL 사용
        baseURL: this.options.anthropicBaseUrl || getDefaultBaseUrl('anthropic'),
        fetch,
      })
    }
    return this.client
  }
}
```

## 새 프로바이더 추가하기

1. `/src/shared/api-endpoints.ts`에 새 엔드포인트 추가:

```typescript
export const API_ENDPOINTS = {
  // ... 기존 프로바이더들
  
  newProvider: {
    baseUrl: "https://api.newprovider.com/v1",
    description: "New Provider API",
  },
}
```

2. 프로바이더 핸들러에서 사용:

```typescript
import { getDefaultBaseUrl } from '@shared/api-endpoints'

const baseUrl = this.options.newProviderBaseUrl || getDefaultBaseUrl('newProvider')
```

## 지원하는 프로바이더

현재 다음 프로바이더들의 엔드포인트가 설정되어 있습니다:

- Anthropic (Claude)
- OpenAI
- OpenRouter
- AWS Bedrock
- Google Vertex AI
- Google Gemini
- Ollama (로컬)
- LM Studio (로컬)
- DeepSeek
- Qwen (국제/중국)
- Qwen Code
- Doubao
- Mistral
- LiteLLM
- Moonshot
- Nebius
- Fireworks
- AskSage
- X.AI (Grok)
- SambaNova
- Cerebras
- Groq
- Hugging Face
- SAP AI Core
- Requesty
- Together AI
- Baseten
- Huawei Cloud MaaS
- Dify
- Vercel AI Gateway
- Z.AI (GLM)
- OCA
- AIHubMix
- Minimax
- Hicap
- Nous Research
- Cline Provider

## 장점

1. **유지보수 용이**: 모든 URL을 한 곳에서 관리
2. **일관성**: 모든 프로바이더가 동일한 패턴 사용
3. **확장성**: 새 프로바이더 추가가 간단
4. **타입 안전성**: TypeScript로 타입 체크
5. **문서화**: 각 엔드포인트에 설명 포함

## 마이그레이션 가이드

기존 프로바이더를 새 시스템으로 마이그레이션하려면:

1. Import 추가:
```typescript
import { getDefaultBaseUrl } from '@shared/api-endpoints'
```

2. 하드코딩된 URL을 함수 호출로 변경:
```typescript
// 변경 전
baseURL: this.options.baseUrl || undefined

// 변경 후
baseURL: this.options.baseUrl || getDefaultBaseUrl('providerName')
```

3. 지역별 엔드포인트가 있는 경우:
```typescript
baseURL: this.options.baseUrl || getDefaultBaseUrl('providerName', region)
```
