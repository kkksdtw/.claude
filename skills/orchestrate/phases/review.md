---
description: Expert review of the plan. One plan critic always, plus risk lenses selected by what the plan touches.
---

# Expert Plan Review

플랜을 리뷰한다. 기본은 비평가 1명이고, 플랜이 건드리는 리스크 영역에 해당하는 렌즈만 병렬로 추가한다.
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

## 2. Select Reviewers

리뷰어는 **프로젝트 유형이 아니라 플랜이 실제로 건드리는 것**으로 고른다. 할 일이 없는 리뷰어도 무언가를 찾아내므로, 관련 없는 렌즈는 토큰과 노이즈만 늘린다.

### 2a. 비평가 (항상 1명)

| Agent (subagent_type) | 모델 | Review Focus |
|----------------------|------|-------------|
| `architect` | `opus` | ① **스펙 충족** — Requirements의 모든 항목이 Implementation Phases에 대응하는가, 요청되지 않은 항목이 끼어들지 않았는가 ② **실현 가능성** — `patternAnchors`와 실제 코드 기준으로 플랜이 가정한 구조·API가 존재하는가 ③ 레이어·모듈 경계와 에이전트 배정의 파일 충돌 |

> 비평가는 코드 없이 플랜만으로 판단해야 하는 자리라 가장 강한 모델을 쓴다. `projectType`에 맞춰 ③의 관점(백엔드: 레이어·의존성 방향 / 프론트엔드: 컴포넌트·상태 경계)을 프롬프트에 적는다.

### 2b. 리스크 렌즈 (트리거에 해당할 때만)

플랜의 Requirements·Implementation Phases를 읽고 아래 트리거에 **실제로 해당하는 렌즈만** 추가한다. 트리거는 [에스컬레이션 조건](../SKILL.md#autonomy-mode-게이트-자동-통과-vs-승인) 2~4번, [fast 부적합 판정](start.md#05-speed-판별---fast)과 같은 영역이다.

| 트리거 | Agent (subagent_type) | Review Focus |
|--------|----------------------|-------------|
| 테이블·컬럼·인덱스 추가/변경, 마이그레이션 | `schema-designer` | 테이블 구조, 관계, 인덱스, 마이그레이션 안전성(비가역·락), 제약조건, 네이밍 |
| auth/authz, public 엔드포인트, 시크릿·토큰, 사용자 입력을 쿼리·명령·HTML로 넘김 | `security-reviewer` | 인증·인가 우회, injection, XSS·CSP, 민감 데이터 노출, rate limiting, 입력 검증 |
| 엔드포인트 신설·변경, 요청/응답 계약 변경 | `api-designer` | REST 규칙, 에러 응답 형식, 페이지네이션, 버전관리, DTO 경계, breaking change |
| 목록·대량 조회, 배치·루프 안 I/O, 새 쿼리 경로, 번들에 의존성 추가 | `performance-reviewer` | N+1, 누락 인덱스, 트랜잭션 범위 / 번들 사이즈, 렌더링, 요청 워터폴 |
| 화면·컴포넌트 신설·변경 | `ux-reviewer` | 접근성(a11y), 반응형, 로딩/에러/빈 상태, 인터랙션 패턴 |

- 렌즈는 전부 `model: "sonnet"`으로 핀 고정한다 (렌즈마다 관점이 좁아 sonnet으로 충분하다).
- 트리거가 애매하면 추가하는 쪽을 택한다. 단 **"혹시 몰라서" 전부 켜지 않는다** — 그러면 고정 그룹과 같아진다.
- 해당 렌즈가 없으면 비평가 1명만 실행한다. 그것도 정답이다.
- 선택 결과(비평가 + 켠 렌즈와 그 트리거)를 plan markdown의 Status 아래에 한 줄로 남긴다. 자율 모드에서는 발화하지 않는다.

## 3. Launch Reviews (병렬)

비평가와 선택된 렌즈를 **한 메시지에서 동시에** Task 도구로 실행한다.

> 단일 fan-out(N명 리뷰 → 결과 집계)이라 Workflow 스크립트가 필요 없다 — Task 병렬이 더 단순하고
> 샌드박스 제약(결정성·args 직렬화 등)에서 자유롭다. 구조화 출력은 프롬프트로 강제한다
> ([references/workflow-authoring.md](../references/workflow-authoring.md) 참조).
> 이 스킬의 지시에 의한 병렬 에이전트 실행이므로 multi-agent orchestration opt-in 조건을 충족한다.

### 3a. 에이전트 프롬프트 (공통)

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
   {해당 에이전트의 Review Focus — §2a/§2b 테이블에서 복사}
3. 위 참조 패턴을 읽어 기존 규칙과의 일관성을 확인하세요. 참조 패턴으로 답이 안 나오는 부분만 직접 관련된 파일을 좁게 Grep/Glob 하세요 — **광역 탐색은 리뷰 지연의 주원인**이므로 최소화합니다.
4. 파일을 생성·수정하지 마세요. 리뷰만 하고 결과는 JSON으로 보고합니다.
5. CRITICAL/HIGH에는 반드시 `evidence`를 붙이세요 — 플랜의 어느 문장이 실제 코드(`file:line`)의 어떤 사실과 충돌하는지. 근거를 댈 수 없으면 MEDIUM 이하로 매기세요.
```

> 출력 형식(3b의 JSON 블록)을 이 프롬프트 끝에 덧붙여 구조화 출력을 강제한다.

> **앵커가 없으면**(state에 `patternAnchors` 필드가 없거나 빈 배열 — 이전 버전에서 시작해 재개한 워크플로우 포함) "참조 패턴" 절을 빼고 작업 3번을 `프로젝트 소스코드를 탐색해 기존 패턴·규칙과의 일관성을 확인하세요. 플랜과 직접 관련된 범위로 좁혀 탐색합니다.`로 쓴다.

### 3b. 실행 + 출력 형식

각 에이전트를 **한 메시지에서 동시에** Task 도구로 띄운다 (`subagent_type` = §2a/§2b 테이블의 agent 이름).

> **모델**: 비평가(`architect`)는 `model: "opus"`, 렌즈는 `model: "sonnet"`을 **호출마다 명시한다.** 생략하면 에이전트 frontmatter의 모델이 적용되어 의도와 달라진다.

각 에이전트의 JSON 출력을 파싱해 Section 4에서 severity별로 집계한다.
수정 후 일부 에이전트만 재실행할 때는 해당 에이전트의 Task만 다시 띄운다.

3a 프롬프트 끝에 아래 출력 형식을 덧붙여 구조화 출력을 강제한다:

```
## 출력 형식
아래 JSON 하나만 출력하세요 (다른 텍스트 없이):
{
  "agent": "{agent_type}",
  "findings": [
    { "severity": "CRITICAL | HIGH | MEDIUM | LOW", "finding": "...", "recommendation": "...", "evidence": "플랜 §X의 '...' ↔ src/a.ts:42 — ... (CRITICAL/HIGH 필수)" }
  ]
}
문제가 없으면 "findings": []
```

## 4. Verify, Aggregate & Fix (state의 `attempts.planFix`로 추적, 최대 2회)

구조화된 findings를 severity별로 정리한다. **자율 모드에서는 이 통합 리포트를 발화하지 않는다** ([발화 규율](../SKILL.md#output-discipline-발화-규율)) — CRITICAL/HIGH는 아래 수정 루프로 처리하고 한도 초과 시에만 에스컬레이션한다. **게이트 모드에서는** 통합 리포트를 사용자에게 보여준다.

**검증 (수정 루프 진입 전, 메인 에이전트가 직접):** 코드 없이 플랜만 본 리뷰는 false positive가 많다. CRITICAL/HIGH마다 `evidence`가 가리키는 파일·줄을 Read로 확인한다.

| 확인 결과 | 처리 |
|-----------|------|
| 근거가 사실이고 플랜이 실제로 그 지점과 충돌 | 유지 → 수정 루프 |
| `evidence` 없음, 근거가 틀림, 이미 플랜에 반영됨 | **MEDIUM으로 내린다** (완료 보고에 "미확인"으로 합산) |
| 보안·데이터 손실 지적인데 코드로 확증·반증이 안 됨 | 유지 — 이 영역은 의심만으로도 수정 대상이다 |

> 검증은 지적 하나당 Read 1~2회로 끝낸다. 재리뷰를 띄우지 않는다.

**severity 상한 규칙 (집계 시 적용):** **추상화·확장성 추가 요구는 CRITICAL/HIGH가 될 수 없다.** 구현체가 하나뿐인 인터페이스·팩토리, 지금 설정하는 곳이 없는 config, "나중에 확장하려면" 목적의 레이어·훅을 추가하라는 권고는 **MEDIUM으로 내려** 기록한다. 이 루프는 플랜의 결함을 고치는 자리이지 플랜을 키우는 자리가 아니다 — CRITICAL/HIGH는 `planFix`를 소모하며 플랜을 실제로 부풀린다.

> 단 **보안·권한·데이터 정합성·입력 검증·접근성** 지적은 이 규칙의 대상이 아니다 — 원래 severity를 그대로 유지한다. 이 영역은 단순화 대상이 아니다.

| 조건 | 행동 |
|------|------|
| 검증을 통과한 CRITICAL 또는 HIGH | `attempts.planFix` +1 → state Write → 플랜을 수정하고 **해당 에이전트만** 재실행 (수정 내역은 자율 모드에서 발화하지 않고 완료 보고에 합산 / 게이트 모드는 리포트에 포함) |
| MEDIUM 이하만 | **자율 모드**: 발화하지 않고 자동 진행 (완료 보고에 합산) · **게이트 모드**: 사용자에게 보고 후 진행 여부 확인 |
| `attempts.planFix` = 2인데 CRITICAL 잔존 | STOP: 사용자에게 수동 판단 요청 (자율 모드도 [에스컬레이션 조건](../SKILL.md#autonomy-mode-게이트-자동-통과-vs-승인) 6번으로 멈춤) |

> 카운터는 state에 영속된다 — 세션이 끊겨도 한도가 유지된다.

## 5. Approve

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

- [ ] 비평가와 선택된 렌즈가 모두 리뷰 완료 (선택 근거가 plan markdown에 기록됨)
- [ ] CRITICAL/HIGH를 `evidence` 기준으로 검증함
- [ ] CRITICAL/HIGH 이슈가 모두 해소됨
- [ ] 플랜 markdown에 승인 상태 기록
- [ ] state JSON의 expertReviews 필드에 각 에이전트 결과 기록
- [ ] Gate 2 통과 — 자율 모드: 확인 없이 자동 진행 / 게이트 모드: 사용자 확인

> `/orchestrate`로 실행 중이면 자동으로 impl phase로 진행한다.
> 단독 실행(`/orchestrate --only review`)이면 사용자에게 안내: `/orchestrate --only impl`
