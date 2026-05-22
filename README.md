# 포토클리닉 4채널 분석기 — 인스타그램 분석기 통합형

이 프로젝트는 기존 인스타그램 분석기를 4채널 분석기 안으로 통합한 버전입니다.

- 인스타그램 URL만 입력하면: 인스타그램 단독 분석기처럼 동작
- 인스타그램 + 홈페이지 + 네이버 플레이스 + 블로그를 입력하면: 4채널 종합 분석기처럼 동작

## 핵심 변경

인스타그램 분석은 Apify 3개 Actor를 함께 사용하도록 확장했습니다.

1. `apify/instagram-scraper`
2. `apify/instagram-post-scraper`
3. `apify/instagram-profile-scraper`

수집 데이터는 서버 API(`/app/api/analyze/route.ts`)에서 처리하며, 브라우저에는 Apify 토큰이 노출되지 않습니다.

## 환경변수

Vercel Settings → Environment Variables에 아래 값을 추가하세요.

```txt
APIFY_TOKEN=apify_api_xxxxxxxxxxxxxxxxx
APIFY_INSTAGRAM_SCRAPER_ACTOR_ID=apify/instagram-scraper
APIFY_INSTAGRAM_POST_SCRAPER_ACTOR_ID=apify/instagram-post-scraper
APIFY_INSTAGRAM_PROFILE_SCRAPER_ACTOR_ID=apify/instagram-profile-scraper
APIFY_INSTAGRAM_LIMIT=18
```

선택적으로 Claude 문장 보정을 사용하려면 아래를 추가하세요.

```txt
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

Claude 키가 없어도 포토클리닉 자체 로직으로 기본 리포트가 생성됩니다.

## 로컬 실행

```bash
npm install
npm run dev
```

## Vercel 배포

1. GitHub 저장소 최상단에 `package.json`, `app/`, `next.config.js`가 보이도록 업로드
2. Vercel에서 GitHub 저장소 Import
3. 환경변수 입력
4. Deploy
5. 환경변수 변경 후에는 반드시 Redeploy

## 리포트 구성

- 인스타그램 프로필/게시물/반응 데이터 통합
- 평균 좋아요, 평균 댓글, 참여율
- 콘텐츠 믹스: 릴스/영상, 캐러셀, 의료진/원장 언급, 공간/장비 언급, 상담/예약 CTA
- 반응 좋은 게시물 TOP
- 해시태그/캡션 키워드
- 병원 신뢰 체크리스트
- 상담 전환 체크리스트
- 추천 촬영 구성
- 4채널 점수 요약
