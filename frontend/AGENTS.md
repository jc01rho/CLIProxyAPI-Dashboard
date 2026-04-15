# DASHBOARD FRONTEND KNOWLEDGE BASE

> 상위 문서: [../AGENTS.md](../AGENTS.md)

## OVERVIEW

`frontend/`는 React 18 + Vite 기반 대시보드 UI다. `App.jsx`가 날짜 범위, 인증, 조회, 차트, 로그/스킬 패널을 한데 조합한다.

## STRUCTURE

```text
frontend/
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── components/
│   │   ├── Dashboard.jsx
│   │   ├── CredentialStatsCard.jsx
│   │   ├── SkillsPanel.jsx
│   │   ├── LogViewerPanel.jsx
│   │   └── Login.jsx
│   ├── lib/
│   │   ├── database.js
│   │   ├── postgrest.js
│   │   ├── supabase.js
│   │   └── runtimeConfig.js
│   └── workers/
└── vite.config.js
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| 메인 대시보드 상호작용 | `src/App.jsx`, `src/components/Dashboard.jsx` | 대형 파일 핫스팟 |
| PostgREST/Supabase 읽기 스위치 | `src/lib/database.js` | 단일 진입점 |
| PostgREST fetch shape | `src/lib/postgrest.js` | cookie 포함 요청 |
| Supabase 모드 | `src/lib/supabase.js`, `runtimeConfig.js` | runtime env 검증 |
| dev 인증 프록시 | `vite.config.js` | `/rest/v1`, `/api/collector` 보호 |

## CONVENTIONS

- 데이터 읽기는 `database.js`를 통해 공통화한다.
- 로컬 dev에서도 production과 같은 auth session 흐름을 유지한다.
- 환경값은 `window.__APP_CONFIG__` → `import.meta.env` 순서로 읽는다.
- 현재 별도 테스트 프레임워크는 없다. 검증은 빌드/수동 확인 중심이다.

## ANTI-PATTERNS

- 컴포넌트에서 PostgREST와 Supabase를 직접 분기하지 않는다.
- dev bypass 인증을 기본 전제로 한 코드 흐름을 넣지 않는다.
- 차트/패널 로직을 무계획하게 `App.jsx`에 더 누적시키지 않는다.
