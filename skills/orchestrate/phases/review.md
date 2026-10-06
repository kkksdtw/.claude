---
description: Expert review of the plan. Context-aware agent groups (backend/frontend/fullstack) review and approve.
---

# Expert Plan Review

플랜을 병렬 전문가 에이전트로 리뷰한다.
Prerequisite: `/orchestrate --only start`에서 플랜 작성 완료 + Gate 1 통과.

## 0. State Guard

아래 절차를 순서대로 수행한다. 실패 시 즉시 중단하고 사용자에게 알린다.

1. **State 파일 탐색**: Glob으로 `plans/*.state.json` 검색
   - 파일 없음 → STOP: "`/orchestrate --only start`를 먼저 실행하세요"
   - 파일 여러 개 → 목록을 보여주고 AskUserQuestion으로 선택 요청
2. **State 읽기**: Read 도구로 state.json을 읽고 JSON 파싱
2a. **Speed 확인**: `speed === "fast"`면 이 phase는 원래 스킵 대상이다 ([Speed Mode](../SKILL.md#speed-mode---fast)). `/orchestrate` 파이프라인은 여기로 진입하지 않으므로, 도달했다면 사용자가 **단독 실행**한 것이다 → AskUserQuestion으로 확인한다: "fast 모드 워크플로우입니다. expert review는 원래 스킵되는 단계인데 지금 실행할까요?"
   - 실행 → 아래 절차를 정상 수행하고, 종료 시 `gates.review`를 `"skipped"`가 아닌 `true`로 기록한다
   - 취소 → STOP: "`/orchestrate --only impl`로 진행하세요"
3. **작업 디렉토리 전환**: `workPath` 디렉토리 존재 확인 후 Bash `cd {workPath}` 실행 → 없으면 STOP. 이후 모든 명령은 이 디렉토리에서 실행
4. **브랜치 확인** (worktree 모드만): `git branch --show-current`가 `branchName`과 일치하는지 확인 → 불일치 시 STOP. main 모드는 생략
5. **필드 추출**: workspace, **autonomy**, projectType, techStack, commands, **patternAnchors**, planFile, branchName, baseBranch 등 필요한 값 보관
6. **Phase 갱신**: state의 `currentPhase`를 `"review"`로, `updatedAt`을 현재 시각으로 갱신 → Write로 저장

## 1. Read Plan

state JSON의 `planFile` 경로를 Read 도구로 읽어 플랜 내용을 확보한다.

## 2. Select Agent Group

아래 기준으로 에이전트 그룹을 결정한다. **첫 번째 매치 사용:**

| 우선순위 | 조건 | 그룹 |
|---------|------|------|
| 1 | `--group backend` 또는 `--group frontend` 플래그 | 지정된 그룹 |
| 2 | state JSON의 `projectType` 값 | 해당 그룹 사용 |
| 3 | `nest-cli.json` 또는 `src/main.ts` 존재 | BACKEND |
| 4 | `next.config.*` 또는 `app/layout.tsx` 존재 | FRONTEND |
| 5 | backend + frontend 파일 모두 존재 | FULLSTACK |
| 6 | 위 어디에도 해당 없음 | AskUserQuestion으로 사용자에게 질문 |

## 3. Agent Group Definitions

### BACKEND_GROUP (5 agents)

| # | Agent (subagent_type) | Review Focus |
|---|----------------------|-------------|
| 1 | `schema-designer` | 테이블 구조, 관계, 인덱스, 마이그레이션 안전성, 제약조건, 네이밍 |
| 2 | `architect` | 레이어 분리, 의존성 방향, DI 토큰, bounded context, 도메인 이벤트 |
| 3 | `api-designer` | REST 규칙, 에러 응답 형식, 페이지네이션, 버전관리, DTO 경계 |
| 4 | `security-reviewer` | SQL injection, auth/authz 우회, rate limiting, 민감 데이터 노출, 입력 검증 |
| 5 | `performance-reviewer` | N+1 쿼리, 누락 인덱스, 캐싱 전략, 커넥션 관리, 트랜잭션 범위 |

### FRONTEND_GROUP (4 agents)

| # | Agent (subagent_type) | Review Focus |
|---|----------------------|-------------|
| 1 | `architect` | 컴포넌트 구조, 상태 관리, 라우팅, 코드 스플리팅, 모듈 경계 |
| 2 | `ux-reviewer` | 접근성(a11y), 반응형, 로딩/에러/빈 상태, 인터랙션 패턴 |
| 3 | `security-reviewer` | XSS, CSP, 토큰 저장, CORS, 서드파티 스크립트, 클라이언트 민감 데이터 |
| 4 | `performance-reviewer` | 번들 사이즈, 렌더링 최적화, lazy loading, 요청 워터폴, 메모리 누수 |

### FULLSTACK_GROUP (6 agents)

BACKEND_GROUP 전체(5) + FRONTEND_GROUP의 `ux-reviewer`(1).
ux-reviewer는 프론트엔드 관점의 리뷰 포커스를 그대로 유지한다.

## 4. Launch Reviews (병렬)

선택된 그룹의 **모든 에이전트를 한 메시지에서 동시에** Task 도구로 실행한다.

> 단일 fan-out(N명 리뷰 → 결과 집계)이라 Workflow 스크립트가 필요 없다 — Task 병렬이 더 단순하고
> 샌드박스 제약(결정성·args 직렬화 등)에서 자유롭다. 구조화 출력은 프롬프트로 강제한다
> ([references/workflow-authoring.md](../references/workflow-authoring.md) 참조).
> 이 스킬의 지시에 의한 병렬 에이전트 실행이므로 multi-agent orchestration opt-in 조건을 충족한다.

### 4a. 에이전트 프롬프트 (공통)

**각 에이전트 프롬프트에 반드시 포함할 내용:**

```
당신은 {agent_type} 전문가입니다.

## 컨텍스트
- 프로젝트 경로: {workPath}
- 기술 스택: {state JSON의 techStack 값}
- 플랜 파일: {planFile의 절대 경로}

## 참조 패턴
아래는 이 프로젝트에서 같은 일을 이미 하고 있는 코드입니다. 일관성 판단의 기준으로 삼으세요.
{state의 patternAnchors를 "- {path} — {role}" 형태로 나열}

## 작업
1. Read 도구로 위 플랜 파일을 읽으세요.
2. 아래 관점에서 플랜을 리뷰하세요:
   {해당 에이전트의 Review Focus — 위 테이블에서 복사}
3. 위 참조 패턴을 읽어 기존 규칙과의 일관성을 확인하세요. 참조 패턴으로 답이 안 나오는 부분만 직접 관련된 파일을 좁게 Grep/Glob 하세요 — **광역 탐색은 리뷰 지연의 주원인**이므로 최소화합니다.
```

> 출력 형식(4b의 JSON 블록)을 이 프롬프트 끝에 덧붙여 구조화 출력을 강제한다.

> **앵커가 없으면**(state에 `patternAnchors` 필드가 없거나 빈 배열 — 이전 버전에서 시작해 재개한 워크플로우 포함) "참조 패턴" 절을 빼고 작업 3번을 `프로젝트 소스코드를 탐색해 기존 패턴·규칙과의 일관성을 확인하세요. 플랜과 직접 관련된 범위로 좁혀 탐색합니다.`로 쓴다.

### 4b. 실행 + 출력 형식

각 에이전트를 **한 메시지에서 동시에** Task 도구로 띄운다 (`subagent_type` = 그룹 테이블의 agent 이름).

> **모델**: 모든 리뷰 에이전트를 `model: "sonnet"`으로 핀 고정한다. 플랜 단계 리뷰는 sonnet으로 충분하며, 메인 모델(opus) 상속을 막아 usage·지연을 줄인다.

각 에이전트의 JSON 출력을 파싱해 Section 5에서 severity별로 집계한다.
수정 후 일부 에이전트만 재실행할 때는 해당 에이전트의 Task만 다시 띄운다.

4a 프롬프트 끝에 아래 출력 형식을 덧붙여 구조화 출력을 강제한다:

```
## 출력 형식
아래 JSON 하나만 출력하세요 (다른 텍스트 없이):
{
  "agent": "{agent_type}",
  "findings": [
    { "severity": "CRITICAL | HIGH | MEDIUM | LOW", "finding": "...", "recommendation": "..." }
  ]
}
문제가 없으면 "findings": []
```

## 5. Aggregate & Fix (state의 `attempts.planFix`로 추적, 최대 2회)

구조화된 findings를 severity별로 정리한다. **자율 모드에서는 이 통합 리포트를 발화하지 않는다** ([발화 규율](../SKILL.md#output-discipline-발화-규율)) — CRITICAL/HIGH는 아래 수정 루프로 처리하고 한도 초과 시에만 에스컬레이션한다. **게이트 모드에서는** 통합 리포트를 사용자에게 보여준다.

**severity 상한 규칙 (집계 시 적용):** **추상화·확장성 추가 요구는 CRITICAL/HIGH가 될 수 없다.** 구현체가 하나뿐인 인터페이스·팩토리, 지금 설정하는 곳이 없는 config, "나중에 확장하려면" 목적의 레이어·훅을 추가하라는 권고는 **MEDIUM으로 내려** 기록한다. 이 루프는 플랜의 결함을 고치는 자리이지 플랜을 키우는 자리가 아니다 — CRITICAL/HIGH는 `planFix`를 소모하며 플랜을 실제로 부풀린다.

> 단 **보안·권한·데이터 정합성·입력 검증·접근성** 지적은 이 규칙의 대상이 아니다 — 원래 severity를 그대로 유지한다. 이 영역은 단순화 대상이 아니다.

| 조건 | 행동 |
|------|------|
| CRITICAL 또는 HIGH 발견 | `attempts.planFix` +1 → state Write → 플랜을 수정하고 **해당 에이전트만** 재실행 (수정 내역은 자율 모드에서 발화하지 않고 완료 보고에 합산 / 게이트 모드는 리포트에 포함) |
| MEDIUM 이하만 | **자율 모드**: 발화하지 않고 자동 진행 (완료 보고에 합산) · **게이트 모드**: 사용자에게 보고 후 진행 여부 확인 |
| `attempts.planFix` = 2인데 CRITICAL 잔존 | STOP: 사용자에게 수동 판단 요청 (자율 모드도 [에스컬레이션 조건](../SKILL.md#autonomy-mode-게이트-자동-통과-vs-승인) 6번으로 멈춤) |

> 카운터는 state에 영속된다 — 세션이 끊겨도 한도가 유지된다.

## 6. Approve

모든 CRITICAL/HIGH가 해소되면, plan markdown의 Status를 갱신:
```
Status: Plan approved — proceed with /orchestrate --only impl
Approved: {날짜}
Reviews: {Agent1} OK | {Agent2} OK | ...
```

state JSON을 Read → 아래 필드 갱신 → Write:
```jsonc
{
  "expertReviews": {
    "architect": "approved",
    "security-reviewer": "approved"
    // ... 각 에이전트의 결과
  },
  "updatedAt": "{현재 ISO 8601}"
}
```

## GATE 2: Expert Approval

**`autonomy` 값에 따라 분기**한다:

- **자율 모드 (`auto`)**: [발화 규율](../SKILL.md#output-discipline-발화-규율)에 따라 **리뷰 결과 요약을 출력하지 않고 즉시 자동 통과**해 impl phase로 진행한다 (모든 CRITICAL/HIGH가 해소된 경우). "진행할까요?" 같은 확인을 **묻지 않는다.** 미해소 CRITICAL/HIGH가 남았을 때만 [에스컬레이션 조건](../SKILL.md#autonomy-mode-게이트-자동-통과-vs-승인) 6번에 따라 멈추고 질문한다.
- **게이트 모드 (`gated`)**: **STOP.** 리뷰 결과 요약을 보여주고 사용자에게 확인을 요청한다.

통과(자동 또는 확인)하면 → state JSON을 Read → 아래 필드 갱신 → Write:
```jsonc
{
  "gates": { "review": true },
  "currentPhase": "impl",
  "updatedAt": "{현재 ISO 8601}"
}
```

## Done Criteria

- [ ] 선택된 그룹의 모든 에이전트가 리뷰 완료
- [ ] CRITICAL/HIGH 이슈가 모두 해소됨
- [ ] 플랜 markdown에 승인 상태 기록
- [ ] state JSON의 expertReviews 필드에 각 에이전트 결과 기록
- [ ] Gate 2 통과 — 자율 모드: 확인 없이 자동 진행 / 게이트 모드: 사용자 확인

> `/orchestrate`로 실행 중이면 자동으로 impl phase로 진행한다.
> 단독 실행(`/orchestrate --only review`)이면 사용자에게 안내: `/orchestrate --only impl`
