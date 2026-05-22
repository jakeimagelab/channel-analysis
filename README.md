# 포토클리닉 채널 분석기 — Fixed Next.js Version

기존 `photoclinic_analyzer_v3.html`의 두 가지 핵심 문제를 해결한 버전입니다.

## 해결한 것

### 1. Claude API 직접 호출 제거
기존 HTML은 브라우저에서 `https://api.anthropic.com/v1/messages`를 직접 호출하는 구조였습니다.  
이 방식은 API Key를 넣는 순간 GitHub/Vercel 배포 시 노출 위험이 큽니다.

변경 후 구조:

```txt
브라우저 화면
↓
/api/analyze
↓
서버에서 ANTHROPIC_API_KEY 사용
↓
Claude 분석 결과 반환
```

### 2. 실제 수집 데이터 기반 분석
기존 파일은 URL을 프롬프트에 넣고 Claude에게 맡기는 구조라 실제 크롤링/수집 로직이 부족했습니다.

변경 후 구조:

```txt
인스타그램 URL → Apify Actor로 최근 게시물 수집
홈페이지 URL → 서버에서 HTML title/meta/headings/images/text 수집
네이버 플레이스 URL → 서버에서 접근 가능한 HTML 정보 수집
블로그 URL → 서버에서 접근 가능한 HTML 정보 수집
수집 데이터 → Claude 분석 프롬프트에 포함
```

Claude API Key가 없거나 Claude 호출이 실패하면, 완전한 가짜 mock 대신 **수집 데이터 기반 간이 채점**으로 결과를 반환합니다.

## 설치

```bash
npm install
```

## 환경변수 설정

`.env.example`을 참고해 `.env.local` 파일을 만드세요.

```bash
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx
ANTHROPIC_MODEL=claude-sonnet-4-20250514

APIFY_TOKEN=apify_api_xxxxxxxxxxxxxxxxx
APIFY_INSTAGRAM_ACTOR_ID=apify/instagram-scraper
APIFY_INSTAGRAM_LIMIT=12
```

## 실행

```bash
npm run dev
```

브라우저에서 확인:

```txt
http://localhost:3000
```

## Vercel 환경변수

Vercel Project Settings → Environment Variables에 아래 값을 넣으세요.

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL`
- `APIFY_TOKEN`
- `APIFY_INSTAGRAM_ACTOR_ID`
- `APIFY_INSTAGRAM_LIMIT`

## 주요 파일

```txt
app/page.tsx
- 사용자 입력 화면
- 분석 진행 UI
- 결과 리포트 출력

app/api/analyze/route.ts
- 서버 API
- Apify 인스타그램 수집
- 홈페이지/네이버/블로그 HTML 수집
- Claude 분석
- Claude 실패 시 수집 데이터 기반 간이 채점

app/globals.css
- 기존 포토클리닉 디자인 스타일
```

## 주의

네이버 플레이스, 일부 병원 홈페이지, 일부 블로그는 서버 접근을 차단하거나 동적 렌더링으로 HTML 정보가 제한될 수 있습니다.  
이 경우 결과에는 “수집 실패 / 데이터 부족”으로 표시되며, 상용화 단계에서는 Playwright 또는 전용 크롤링 API를 추가하는 것이 좋습니다.
