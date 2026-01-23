# Webview UI 한글화 가이드

## 설치 완료 ✅

- i18next, react-i18next 설치됨
- 기본 설정 파일 생성됨
- 영어(en), 한국어(ko) 번역 파일 생성됨

## 사용 방법

### 1. 컴포넌트에서 사용

```tsx
import { useTranslation } from "react-i18next"
import { useLanguage } from "../hooks/useLanguage"

export const YourComponent = () => {
	const { t } = useTranslation()
	useLanguage() // VS Code 언어 설정 자동 감지

	return (
		<div>
			<h1>{t("welcome")}</h1>
			<button>{t("newTask")}</button>
		</div>
	)
}
```

### 2. 번역 추가

`webview-ui/src/i18n/locales/ko.json`:
```json
{
  "yourKey": "한글 번역"
}
```

`webview-ui/src/i18n/locales/en.json`:
```json
{
  "yourKey": "English translation"
}
```

### 3. 실제 컴포넌트 한글화 예시

기존 코드:
```tsx
<button>New Task</button>
```

변경 후:
```tsx
const { t } = useTranslation()
<button>{t("newTask")}</button>
```

## 주요 파일 위치

- 설정: `webview-ui/src/i18n/config.ts`
- 한국어: `webview-ui/src/i18n/locales/ko.json`
- 영어: `webview-ui/src/i18n/locales/en.json`
- 훅: `webview-ui/src/hooks/useLanguage.ts`

## 빌드

```bash
cd webview-ui
npm run build
```

## 다음 단계

1. `webview-ui/src/components/` 폴더의 컴포넌트들을 찾아서
2. 하드코딩된 텍스트를 `t("key")` 형식으로 변경
3. 번역 키를 `ko.json`, `en.json`에 추가
