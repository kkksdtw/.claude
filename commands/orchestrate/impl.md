---
description: Implement with parallel agents. Plan-based layer development with verification.
---

# Parallel Agent Implementation

승인된 플랜을 병렬 에이전트로 구현한다.
Prerequisite: `/orchestrate:review`에서 expert 승인 완료 + Gate 2 통과.

## 0. State Guard

아래 절차를 순서대로 수행한다. 실패 시 즉시 중단하고 사용자에게 알린다.

1. **State 파일 탐색**: Glob으로 `plans/*.state.json` 검색
   - 파일 없음 → STOP: "`/orchestrate:start`를 먼저 실행하세요"
   - 파일 여러 개 → 목록을 보여주고 AskUserQuestion으로 선택 요청
2. **State 읽기**: Read 도구로 state.json을 읽고 JSON 파싱
3. **작업 디렉토리 전환**: `workPath` 디렉토리 존재 확인 후 Bash `cd {workPath}` 실행 → 없으면 STOP. 이후 모든 명령은 이 디렉토리에서 실행
4. **브랜치 확인** (worktree 모드만): `git branch --show-current`가 `branchName`과 일치하는지 확인 → 불일치 시 STOP. main 모드는 생략
5. **필드 추출**: workspace, **speed**, projectType, techStack, commands, **patternAnchors**, planFile, branchName, baseBranch 등 필요한 값 보관
6. **Phase 갱신**: state의 `currentPhase`를 `"impl"`로, `updatedAt`을 현재 시각으로 갱신 → Write로 저장

## 1. Load Plan

state JSON의 `planFile` 경로를 Read 도구로 읽는다.
플랜의 **Implementation Phases** 섹션에서 에이전트 배정 테이블을 추출한다.

## 2. Execute by Phase (플랜 기반)

플랜에 정의된 phase 순서와 병렬/순차 의존성을 그대로 따른다.

**일반적 패턴 (프로젝트 타입별 예시):**

### Backend (NestJS / Express / Django 등)
- **Phase A (병렬):** Domain 레이어 + Infrastructure 레이어
- **Phase B (순차, A 완료 후):** Application 레이어 (Use Case, Controller, DTO, Module, E2E Test)

### Frontend (Next.js / React 등)
- **Phase A (병렬):** 공통 컴포넌트 + 훅 + 유틸리티
- **Phase B (순차, A 완료 후):** 페이지 컴포넌트 + 라우팅 + 통합 테스트

### Fullstack
- **Phase A (병렬):** Backend domain + Frontend 공통 컴포넌트
- **Phase B (순차):** Backend application + Frontend 페이지

> 위는 예시일 뿐이다. **반드시 플랜에 정의된 phase 구조를 따를 것.** 플랜에 phase 정의가 없으면 사용자에게 확인한다.

### 2a. 배분 확인 (에이전트 실행 전)

phase 벽시계는 **가장 느린 에이전트 하나**가 결정한다. 출발 전에 배정이 기울었는지만 확인한다 — 시작한 뒤에는 되돌릴 수 없다.

플랜 배정 테이블의 예상 파일 수를 보고:

| 조건 | 행동 |
|------|------|
| 최대 / 최소 ≤ 2배 | 그대로 진행 |
| 2배 초과 | 가장 큰 배정을 **이미 파일이 분리된 경계**로 쪼갠다 (read/write repository, 조회/변경 use case 등). 그런 경계가 없으면 쪼개지 않고 그대로 진행한다 — 충돌 처리 비용이 절약분을 먹는다 |
| 예상 파일 수가 테이블에 없음 | 플랜의 작업 항목에서 직접 세어 판단한다. 세기 어려우면 그대로 진행 |

쪼갠 경우 담당 파일 범위를 서로 겹치지 않게 다시 적고, 플랜 markdown의 배정 테이블도 갱신한다. **phase당 5명을 넘기지 않는다** — 에이전트마다 프로젝트 파악 고정비가 붙어 그 이상은 벽시계가 더 줄지 않는다.

> 이 확인은 자율 모드에서 발화하지 않는다 ([발화 규율](../orchestrate.md#output-discipline-발화-규율)).

## 3. Launch Agents

**Workflow 도구 우선**(3b), 미지원·권한 거부 시 Task 병렬 fallback(3c).

> 이 스킬의 지시에 의한 Workflow 호출이므로 multi-agent orchestration opt-in 조건을 충족한다.

### 3a. 에이전트 프롬프트 (공통)

**각 에이전트 프롬프트에 반드시 포함할 내용:**

```
당신은 {담당 영역} 구현 전문가입니다.

## 컨텍스트
- 프로젝트 경로: {workPath}
- 기술 스택: {state JSON의 techStack 값}
- CLAUDE.md 경로: {workPath}/CLAUDE.md (프로젝트 규칙 참조용)

## 플랜
아래는 구현할 내용입니다:
{해당 에이전트에 배정된 플랜 phase의 구체적 작업 항목을 여기에 복사}

## 참조 패턴 (먼저 읽으세요)
아래는 이 프로젝트에서 같은 일을 이미 하고 있는 코드입니다. 구현 전에 Read하세요.
**먼저 이 코드를 재사용·확장해서 요구사항이 끝나는지 판단하고, 안 될 때만 그 구조·네이밍·에러 처리를 따라 새로 쓰세요.**
{이 에이전트에 배정된 patternAnchors를 "- {path} — {role}" 형태로 나열}

## 규칙
1. {workPath} 안에서만 파일을 생성·수정하세요.
2. 위 참조 패턴을 먼저 읽으세요. **재사용·확장으로 끝나면 새 파일을 만들지 말고 기존 코드를 고치세요** — 같은 구조의 파일을 하나 더 만드는 것은 마지막 선택지입니다. 참조 패턴으로 답이 안 나오는 부분만 추가로 탐색(Glob/Grep)하세요 — 패턴을 처음부터 찾는 광역 탐색이 이 단계 소요 시간의 최대 요인입니다.
3. 다른 에이전트가 담당하는 파일은 수정하지 마세요: {다른 에이전트 담당 파일 목록}
4. 완료 후 변경한 파일 경로 목록과 작업 요약을 보고하세요.
```

> **ponytail 규칙은 프롬프트에 복사하지 않는다.** ponytail 플러그인의 `SubagentStart` 훅이 Task(3c)·Workflow(3b) 에이전트 **모두**에 SKILL.md 전문을 주입한다(Workflow 경로는 프로브 에이전트로 실측 확인, 2026-08-20). 요약 사본을 프롬프트에 두면 플러그인 업데이트 시 드리프트만 남는다 — 원칙의 SSOT는 플러그인 SKILL.md 하나다. ponytail 모드를 사용자가 껐다면 주입도 빠지는데, 그것은 사용자 레벨 토글이 의도대로 동작하는 것이므로 보완하지 않는다.

> **앵커가 없는 에이전트**(state에 `patternAnchors` 필드가 없거나 · 비었거나 · 이 에이전트에 배정된 것이 없음 — 이전 버전에서 시작해 재개한 워크플로우가 여기 해당한다)는 "참조 패턴" 절을 통째로 빼고, 규칙 2를 `기존 프로젝트의 코드 패턴을 먼저 탐색(Glob/Grep/Read)하세요. 재사용·확장으로 끝나면 기존 코드를 고치고, 안 될 때만 동일한 패턴으로 새로 쓰세요.`로 쓴다. 빈 절을 남기거나 관련 없는 파일을 채우지 않는다 — 잘못된 앵커는 탐색보다 나쁘다.

**충돌 방지:** 에이전트 간 파일 겹침이 없도록 각 에이전트에게 담당 파일 범위를 명시한다. 공유 파일(예: module registration)은 마지막 순차 phase에서 한 에이전트가 처리한다.

### 3b. Workflow 실행 (기본)

이 단계는 phase 간 순차 barrier·resume이 실제로 필요해 Workflow를 쓴다(review와 달리 단순 fan-out이 아님). **phase 간 순차, phase 내 병렬**이 스크립트 코드로 보장된다.

> **작성 원칙 (필독): 로직은 고정, 데이터만 채운다.** 아래 스크립트의 `meta`·`REPORT`·orchestration·`return`은
> **그대로 복사**하고, 표시된 `const phases = [...]` **데이터 블록 1곳만** 채운다. 데이터 블록엔 **순수 리터럴만** —
> 함수 호출·표현식·`Date.now()`·`new Date()`·`Math.random()` 금지(샌드박스에서 throw). 이 원칙 하나가 모든 제약을 포함한다.
> 전체 규칙: [rules/common/workflow-authoring.md](../../rules/common/workflow-authoring.md).

**`phases` 데이터 블록 채우는 법:**
1. 각 phase·에이전트에 대해 3a 템플릿을 채운 전문 프롬프트를 만든다.
2. 각 프롬프트를 백틱(`` ` ``) **정적** 템플릿 리터럴로 감싼다(보간 `${` 금지·escape).
3. `name`·`area`·`prompt`만 채운다. 그 외 코드는 건드리지 않는다.

**script:**

```javascript
export const meta = {
  name: 'orchestrate-impl',
  description: '플랜 phase 순서대로 구현 — phase 간 순차, phase 내 병렬',
}

// ▼▼▼ FILL: 데이터 블록 — 여기만 채운다 (순수 리터럴 / 로직·Date·random 금지) ▼▼▼
// prompt 는 3a 템플릿을 채운 정적 문자열. 보간 ${ } 금지.
const phases = [
  {
    name: 'A',
    agents: [
      { area: 'domain', prompt: `{3a 템플릿을 채운 전문}` },
      { area: 'infra', prompt: `...` },
    ],
  },
  { name: 'B', agents: [ /* ... */ ] },
]
// ▲▲▲ FILL 끝 — 아래 코드는 그대로 복사, 수정 금지 ▲▲▲

const REPORT = {
  type: 'object',
  required: ['files', 'summary'],
  properties: {
    files: { type: 'array', items: { type: 'string' } },   // 생성·수정한 파일 경로
    summary: { type: 'string' }
  }
}
const done = []
for (const p of phases) {
  log('Phase ' + p.name + ': agents ' + p.agents.length)
  const results = await parallel(p.agents.map(a => () =>
    agent(a.prompt, { label: 'impl:' + a.area, phase: p.name, schema: REPORT, model: 'sonnet' })
  ))
  done.push({ phase: p.name, results: results.filter(Boolean) })
}
return { phases: done, files: done.flatMap(d => d.results.flatMap(r => r.files)) }
```

> phase 간 barrier는 의도적이다 — 다음 phase가 이전 phase의 파일에 의존한다.
> 에이전트들은 같은 workPath에서 파일을 만든다. 담당 파일이 겹치지 않으므로(충돌 방지 규칙) worktree isolation은 쓰지 않는다.

반환값의 `files`(전체 변경 파일 목록)를 done phase의 코드 리뷰·커밋 스테이징에 활용한다.

### 3c. Task fallback (Workflow 미지원·거부 시)

플랜의 phase 순서대로, 각 phase의 에이전트를 **동시에** Task 도구(`subagent_type: "general-purpose"`, `model: "sonnet"`)로 실행한다. 다음 phase는 이전 phase의 모든 에이전트 완료 후 시작한다.

> 구현 워커는 `model: "sonnet"`으로 실행한다 — 메인 모델(opus) 상속 금지. usage 절감 목적.

## 4. Integration Verification

> **fast 모드는 이 섹션 전체를 스킵한다.** `speed === "fast"`면 lint·build·test·테스트 DB 준비를 하지 않고 곧바로 §5로 간다 — 검증은 done phase에서 **1회로 통합**해 실행된다 ([Speed Mode](../orchestrate.md#speed-mode---fast)). **자율 모드에서는 이 스킵을 발화하지 않는다** ([발화 규율](../orchestrate.md#output-discipline-발화-규율)) — done phase의 검증이 실제 실행되므로 완료 보고에 자연히 드러난다.
>
> 이때 `implVerifiedClean`은 **false로 남긴다.** done phase의 스킵 조건이 거짓이 되어 검증이 반드시 실행된다 — fast에서 검증이 통째로 사라지지 않도록 막는 장치다.

모든 에이전트 완료 후, state JSON의 `commands` 필드에 저장된 명령어를 순서대로 실행:

1. **Lint**: `commands.lint` 값을 Bash로 실행 (예: `pnpm lint`)
2. **Build**: `commands.build` 값을 Bash로 실행 (예: `pnpm build`)
3. **Test DB 준비**: `rules/common/test-db-isolation.md` 프로토콜의 1~6단계를 수행한다.
   - state.json에 `testDatabase.name`이 있고 실제 DB가 존재하면 기존 DB 재사용
   - 없으면 감지 → 템플릿 복제 → state 기록 (템플릿이 이미 있으면 마이그레이션은 돌지 않는다)
4. **Test**: 프로토콜 §5의 서브셸 형태로 실행한다. `.env`를 Read하거나 URL을 인자로 늘어놓지 않는다

> state JSON에 commands 값이 없는 경우 → AskUserQuestion으로 사용자에게 명령어를 직접 질문

**실패 시 처리** (state의 `attempts.implVerify`로 추적 — 실패마다 +1 후 state Write, 최대 3회):

| attempts.implVerify | 행동 |
|------|------|
| 1~2 | 에러 메시지를 분석하고 직접 수정 후 재실행 |
| 3 | Task 도구로 `build-error-resolver` 에이전트 실행 |
| 3 초과 | STOP: 사용자에게 에러 내용 보고 및 수동 해결 요청 |

전체 통과 시 `attempts.implVerify`를 0으로 리셋한다. 카운터는 state에 영속 — 세션이 끊겨도 한도 유지.

## 5. Update State

state JSON을 Read → **`speed` 값에 따라** 아래 필드 갱신 → Write:

**normal** — verification 결과를 기록:
```jsonc
{
  "verification": {
    "lint": "pass",                    // 또는 "fail"
    "build": "pass",                   // 또는 "fail"
    "test": "pass",                    // 또는 "fail"
    "lastRunAt": "{현재 ISO 8601}"
  },
  "implVerifiedClean": true,           // lint·build·test 전부 pass일 때만 true. 하나라도 fail이면 false 유지
  "currentPhase": "done",
  "updatedAt": "{현재 ISO 8601}"
}
```

**fast** — 검증하지 않았으므로 결과를 남기지 않는다:
```jsonc
{
  "verification": {
    "lint": null,                      // 검증 미실행 — done phase가 채운다
    "build": null,
    "test": null,
    "lastRunAt": null
  },
  "implVerifiedClean": false,          // 반드시 false — done의 검증 스킵 조건을 거짓으로 만든다
  "currentPhase": "done",
  "updatedAt": "{현재 ISO 8601}"
}
```

> `implVerifiedClean`은 **전체 통과 시에만** true로 쓴다. done phase가 곧바로 이어질 때 중복 검증을 건너뛰기 위한 플래그다.
> fast는 impl에서 검증하지 않으므로 항상 false다 — "검증 안 함"을 "검증 통과"로 잘못 기록하면 done이 검증을 건너뛰어 **아무도 검증하지 않은 코드가 PR로 나간다.**

## Done Criteria

- [ ] 플랜의 모든 phase 에이전트가 완료됨
- [ ] **normal만** — Lint 통과
- [ ] **normal만** — Build 통과
- [ ] **normal만** — Test 통과
- [ ] state JSON의 verification 필드 기록 — normal: 결과값 / fast: null 유지
- [ ] `implVerifiedClean` — normal: 전체 통과 시에만 true / fast: 반드시 false
- [ ] currentPhase가 "done"으로 갱신됨

> `/orchestrate`로 실행 중이면 자동으로 done phase로 진행한다.
> 단독 실행(`/orchestrate:impl`)이면 사용자에게 안내: `/orchestrate:done`
