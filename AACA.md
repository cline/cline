### 1. 진입화면 수정 - data-steps.ts
USER_TYPE_SELECTIONS 배열을 수정하여 "Bring my own API key" (bringOwnApiKey) 옵션만 표시되도록 했습니다. 
이제 온보딩 화면에서 FREE와 POWER 옵션은 제거되고 BYOK 옵션만 보이게 됩니다.
```Typescript
export const USER_TYPE_SELECTIONS: UserTypeSelection[] = [
	// { title: "Absolutely Free", description: "Get started at no cost", type: NEW_USER_TYPE.FREE },
	// { title: "Frontier Model", description: "Claude 4.5, GPT-5 Codex, etc", type: NEW_USER_TYPE.POWER },
	{ title: "Bring my own API key", description: "Use Cline with your provider of choice", type: NEW_USER_TYPE.BYOK },
]
```

### 2. OnboardingView.tsx 수정
- 로그인 버튼 제거 ( line : 408 )
```Typescript
const buttons = step
    ? stepNumber === 0
        ? [
                { text: t("onboarding.continue"), action: "next" as const, variant: "default" as const },
                // { text: t("onboarding.loginToCline"), action: "signin" as const, variant: "secondary" as const },
            ]
        : [{ text: t("onboarding.back"), action: "back" as const, variant: "secondary" as const }]
]
```

### 3. FeatureSettingsSection.tsx CLI 설치 부분 제외 
70 Line: TODO; Cline CLI 부분

온보딩 시작 시 기본값이 BYOK로 설정되어 Ollama를 포함한 API Provider 선택 화면이 표시됩니다.
```Typescript
// 현재  
const [userType, setUserType] = useState<NEW_USER_TYPE>(NEW_USER_TYPE.FREE)

// 변경 후
const [userType, setUserType] = useState<NEW_USER_TYPE>(NEW_USER_TYPE.BYOK)

http://192.168.2.81:11434
```

### 4. 프로바이더 선택 목록
/Users/honghyosang/project/aaca_cline/src/shared/providers/providers.json 파일에 정의 

ApiOptions.tsx 컴포넌트에서 사용되며, 플랫폼 타입과 원격 설정에 따라 필터링