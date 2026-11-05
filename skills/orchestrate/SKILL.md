---
name: orchestrate
argument-hint: "[--fast] [--gated] [--main] <요구사항> | --only <start|review|impl|done|cleanup>"
disable-model-invocation: true
description: Full orchestrated workflow. Requirements → workspace → plan → expert review → implement → verify → ship (commit/PR). Use --fast to skip expert review and collapse verification into a single pass.
---

# Orchestrate Workflow

E2E pipeline: requirements → workspace → plan → expert review → implement → verify → ship.

## Project Context (MUST be first)

프로젝트 CLAUDE.md·per-package CLAUDE.md·`.claude/rules/`는 자동 로드되므로 별도 Read 없이 참조한다. 단 **sub-agent(Task)에는 전달되지 않으므로** `projectType`·`techStack`·`commands`를 state JSON에 저장한다. 추출 절차: [start.md](phases/start.md) §4a.

## Workspace Mode

| Input | 실행 위치 | Mode |
|-------|-----------|------|
| (기본, `--main` 없음) | main 작업 트리 | **worktree (new)** — gtr로 격리된 worktree를 새로 만들고 그 안에서 개발 |
| (기본, `--main` 없음) | 이미 linked worktree 안 | **worktree (adopt)** — 새로 만들지 않고 현재 worktree·현재 브랜치에서 개발. cleanup이 삭제하지 않는다 (`worktreeCreated = false`). 절차: [start.md](phases/start.md) §3 |
| `--main` flag | 현재 체크아웃 | **main** — 현재 체크아웃에서 직접 개발. 워크스페이스를 만들지 않는다 |

> workspace 모드를 결정하는 것은 `--main` 하나뿐이다. `--fast`·`--gated`는 다른 축이므로 workspace에 영향을 주지 않는다.

| | main 모드 | worktree 모드 |
|---|----------|---------------|
| 개발 위치 | repo 루트 (현재 체크아웃) | gtr worktree |
| 브랜치 | 현재 브랜치 그대로 (보통 main) | `{identifier}` feature 브랜치 |
| 마무리 | **commit까지만** — push는 사용자가 직접 | commit → push → **PR 생성** |
| gtr 미설치 시 | 무관 | **STOP** — 설치 안내 |

### gtr 명령어 (CRITICAL — worktree 모드 전용)

gtr은 Git subcommand다. **반드시 `git gtr`로 실행한다.**

```
CORRECT:  git gtr new <branch>
WRONG:    gtr new <branch>        ← command not found
```

## Speed Mode (`--fast`)

`--fast` 플래그는 **오래 걸리는 단계를 스킵·간소화**해 파이프라인을 최단 경로로 통과시킨다. state의 `speed`에 기록한다 (`"normal"` 기본 / `"fast"`).

**속도 축은 게이트 축(autonomy)과 직교한다.** `--fast`는 무엇을 *하는지*를 줄이고, `--gated`는 *누가 승인하는지*를 바꾼다. 두 플래그는 자유롭게 조합된다.

| 단계 | normal | **fast** |
|------|--------|----------|
| 요구사항 Q&A | 최대 2라운드 | **최대 1라운드** — 추론 가능하면 생략 |
| 플랜 문서 | 7개 섹션 풀 문서 | **3개 섹션 축약** (Requirements · Implementation Phases · Risk) |
| **Phase 2 (expert review)** | 비평가 1명 + 트리거에 해당하는 리스크 렌즈만 병렬 리뷰 → findings 검증 → 수정 루프(2회) | **통째로 스킵** — start → impl로 직행 |
| impl verification | lint + build + test | **스킵** — done에서 1회로 통합 |
| done verification | 조건부 스킵 가능 | **반드시 1회 실행** (lint + build + test) |
| done 코드 리뷰 | security + code + ponytail 렌즈 병렬, 수정 루프 2회 | **동일하게 유지**, 수정 루프 **1회** |
| 커밋 분할 | 논리 단위 최대 4개 | **단일 커밋** |

### fast에서도 줄이지 않는 것 (MOST IMPORTANT)

expert review를 통째로 스킵하므로 **done phase의 코드 리뷰가 유일한 안전망**이다. 아래는 fast에서도 그대로 유지한다:

1. **done phase의 verification 1회** — lint + build + test 전부. 스킵 조건을 적용하지 않는다.
2. **done phase의 코드 리뷰** — `security-reviewer` + `code-reviewer` + ponytail 렌즈 병렬. 축소·생략하지 않는다.
3. **에스컬레이션 조건** — 아래 [Autonomy Mode](#autonomy-mode-게이트-자동-통과-vs-승인)의 6개 조건 전부. fast는 속도를 위해 *검토 단계*를 줄이는 것이지 *판단 기준*을 낮추는 것이 아니다.
4. **테스트 DB 격리** — 로컬/원격 판정을 포함한 [test-db-isolation](references/test-db-isolation.md) 프로토콜 전체.

스키마 마이그레이션·auth 변경·API 계약 변경이나 애매한 요구사항에는 fast를 쓰지 않도록 경고한다: [start.md](phases/start.md) §0.5 fast 부적합 판정.

## Autonomy Mode (게이트 자동 통과 vs 승인)

**기본은 자율 모드다.** 게이트(Gate 1·2·3)에서 사용자 승인을 받지 않고 자동으로 다음 phase로 진행하며, PR 생성까지 무인으로 완료한다. "플랜 승인할까요?"·"진행할까요?"·"PR 만들까요?" 같은 확인을 묻지 않는다. 단 아래 **에스컬레이션 조건**에 하나라도 해당하면 즉시 멈추고 AskUserQuestion으로 사용자 판단을 받는다.

### 모드 결정 (start phase에서 확정 → state의 `autonomy`에 기록)

| 입력 | workspace | autonomy | 동작 |
|------|-----------|----------|------|
| (플래그 없음) | worktree | `auto` | **기본** — Gate 1·2·3 자동 통과 → push → PR. 에스컬레이션 조건만 질문 |
| `--gated` | worktree | `gated` | 각 게이트에서 승인 요청 |
| `--main` (± `--gated`) | main | `gated` | 게이트 승인 방식 + commit까지 |

> **자율 모드는 worktree 전용이다.** main 모드는 실제 main/master에 직접 commit될 수 있어([safety.md](../../rules/devops/safety.md) §4) 자율 커밋을 허용하지 않는다. main 모드에서는 push·PR을 자동 실행하지 않는다.

### 에스컬레이션 조건 (자율 모드에서도 반드시 멈추고 질문)

원칙: **"조금이라도 애매하거나 중대하면 묻는다."** 무리하게 추론해서 진행하지 않는다. 답을 반영한 뒤 자율 진행을 재개한다.

1. **요구사항 애매성** — 필수 스펙이 없거나 여러 해석이 가능하고, 그 차이가 구현을 실질적으로 바꾸는 경우. start Q&A에서 합리적으로 추론 불가한 항목.
2. **데이터 손실·비가역 변경** — 파괴적 마이그레이션(컬럼/테이블 drop, 데이터 유실형 타입 변경), 기존 데이터 삭제·덮어쓰기, 되돌리기 어려운 외부 부수효과. **단, 로컬 격리 테스트 DB에 마이그레이션/DDL을 실행하는 것은 예외 — 자동 허용한다** (테스트 목적이고 대상이 폐기용 임시 DB이므로 잃을 데이터가 없다). staging·운영 등 **공식 환경(원격 DB)** 대상 실행은 절대 금지하며, 그 외 실데이터에 영향을 주는 변경은 멈추고 질문한다. 로컬/원격 판정 기준은 [test-db-isolation.md](references/test-db-isolation.md).
3. **보안 민감 결정** — auth/authz 변경, 엔드포인트 공개(public) 전환, 시크릿 취급, 권한 상승 경로.
4. **호환성 파괴** — 기존 소비자에 영향을 주는 API 계약·스키마 breaking change.
5. **스코프 급증** — 플랜이 요청 범위를 크게 벗어나 커지는 경우.
6. **자동 해소 한도 초과** — expert review CRITICAL/HIGH가 `attempts` 한도 내에 해소되지 않거나, verification이 한도 내에 통과하지 못하는 경우.

### 게이트·확인 지점별 처리

| 지점 | 자율 모드 (`auto`) | 게이트 모드 (`gated`) |
|------|-------------------|----------------------|
| Gate 1 (플랜) | **침묵 자동 통과** (요구사항 애매성 없을 때) | 요약 출력 + 승인 요청 |
| Gate 2 (리뷰) | **침묵 자동 통과** (CRITICAL/HIGH 해소 시) | 요약 출력 + 승인 요청 |
| Gate 3 (ship) | **침묵 자동 통과** → push + PR | 요약 출력 + 승인 요청 |
| MEDIUM/LOW findings | 발화하지 않고 진행 — 완료 보고에 합산 | 진행 여부 확인 |

> `speed = "fast"`면 Gate 2는 review phase 자체가 없으므로 **존재하지 않는다** — `gates.review`는 `"skipped"`로 기록한다.

## Output Discipline (발화 규율)

**자율 모드(`auto`)에서는 작업 중 발화하지 않는다.** 작업지시자에게 보이는 텍스트는 아래 세 시점에만 낸다:

1. **결정 요청** — 에스컬레이션 조건에 해당해 AskUserQuestion을 띄울 때. 질문은 그 자체로 판단에 필요한 맥락을 담는다.
2. **완료 보고** — done phase의 Output에서 **1회**. 작업 요약 + PR 링크(worktree) 또는 커밋 해시(main) + 후속 안내(cleanup 등) + 참고사항(미해결 MEDIUM/LOW, fast 스킵 여부 등)을 한 번에 압축해 전달한다.
3. **STOP** — 한도 초과·오류·gtr 미설치 등으로 자동 진행이 불가능해 중단할 때. 원인과 다음 행동을 알린다.

**발화 금지:** Gate 자동 통과 시의 중간 요약, phase 전환 안내, fast 스킵 안내·검증 낱개 통과 보고·에이전트 수 나열, MEDIUM/LOW findings의 중간 보고(완료 보고로 미룬다).

- **게이트 모드(`gated`)**: 각 Gate에서 요약 + 승인 요청을 출력한다. 게이트 사이의 진행 나열은 하지 않는다.
- Workflow의 `log()`/progress 트리, Task 진행 상태는 하니스 UI 요소이므로 이 규율의 대상이 아니다.

## State Management

모든 orchestrate 워크플로우는 workPath의 `plans/` 디렉토리에 **두 파일**을 생성·관리한다. 두 파일은 워크플로우 메타데이터이므로 **커밋에 포함하지 않는다**.

| File | Purpose |
|------|---------|
| `plans/{identifier}.md` | 사람이 읽는 플랜 (요구사항, phase, 에이전트 배정) |
| `plans/{identifier}.state.json` | 에이전트가 읽는 머신 상태. 스키마: [start.md](phases/start.md) §4c |

1. **Start phase**가 state JSON을 생성한다 (모든 필드 초기화)
2. **모든 phase**는 시작 시 state를 Read로 읽고, 종료 시 Write로 갱신한다
3. **State JSON이 권위적 소스다** — 경로 등 메타데이터는 반드시 state에서 읽고, plan markdown을 파싱하지 않는다
4. timestamp는 `date -u +%Y-%m-%dT%H:%M:%SZ`로 생성한다

## State Guard Pattern (review/impl/done 공통)

모든 phase(start 제외)는 시작 시 아래 절차를 **순서대로** 수행한다. 어느 단계에서든 실패하면 **즉시 중단**하고 사용자에게 상황을 알린다.

1. **State 파일 탐색**: Glob으로 `plans/*.state.json` 검색
   - 파일 없음 → STOP: "state 파일이 없습니다. `/orchestrate --only start`를 먼저 실행하세요"
   - 파일 1개 → 해당 파일 사용
   - 파일 여러 개 → 파일 목록과 각 identifier를 보여주고 AskUserQuestion으로 선택 요청
2. **State 읽기**: Read 도구로 state.json 파일을 읽고 JSON 파싱
3. **작업 디렉토리 전환**: `workPath` 디렉토리 존재를 확인하고 Bash로 `cd {workPath}` 실행 → 없으면 STOP. 이후 모든 Bash 명령은 이 디렉토리에서 실행된다
4. **브랜치 확인** (worktree 모드만): `git branch --show-current`가 state의 `branchName`과 일치하는지 확인 → 불일치 시 STOP
5. **Phase 진입**: state의 `currentPhase`를 현재 phase로, `updatedAt`을 현재 시각으로 갱신 → Write로 저장

## Mandatory Rules

1. 반드시 프로젝트 컨텍스트를 먼저 파악한다 (CLAUDE.md 기반)
2. Expert review·impl 에이전트는 반드시 병렬 실행한다 — review는 **Task 병렬**, impl은 **Workflow**(phase barrier·resume 필요 시). Workflow 스크립트 작성 규칙: [references/workflow-authoring.md](references/workflow-authoring.md)
3. **동시 워크플로우 최대 2개** — 모든 세션이 하나의 usage limit을 공유한다. start phase에서 `plans/*.state.json` 중 진행 중(currentPhase ≠ "completed")인 워크플로우가 이미 2개 이상이면 사용자에게 경고하고, 기존 워크플로우 완료 후 순차 시작을 권고한다. 다른 worktree·레포에서 병렬 실행 중인 세션은 감지할 수 없으므로 사용자에게 한 번 확인한다
4. **병렬 에이전트를 기다릴 때는 턴을 끝낸다 — 폴링 금지** — background 에이전트는 완료 시 하니스가 자동으로 재호출한다. `sleep`으로 시간을 보내거나 state·산출물 파일을 반복 확인하지 않는다. background `sleep`은 **완료가 곧 재호출**이라 자가 웨이크업 루프가 되고, 타이머가 겹쳐 쌓이면 주기가 점점 짧아진다(실측: 5개 중첩, 40분 무한 반복). 완료 알림이 끝내 오지 않는 에이전트는 **`run_in_background: false`로 한 번만** 재실행하고, 그래도 결과가 없으면 STOP한다

## Pipeline Flow (자동 연속 실행)

`/orchestrate` 실행 시 phase들을 **하나의 세션에서 자동으로 연속 실행**한다. 각 phase 파일을 **Read 도구로 읽고, 그 안의 지침을 끝까지 수행한다.**

| 순서 | 파일 | 진입 조건 |
|------|------|-----------|
| 1 | `~/.claude/skills/orchestrate/phases/start.md` | 즉시 시작 |
| 2 | `~/.claude/skills/orchestrate/phases/review.md` | Gate 1 통과 (gates.plan = true). **`speed = "fast"`면 이 파일을 Read하지 않고 건너뛴다** |
| 3 | `~/.claude/skills/orchestrate/phases/impl.md` | normal: Gate 2 통과 (gates.review = true) / fast: Gate 1 통과 즉시 |
| 4 | `~/.claude/skills/orchestrate/phases/done.md` | normal: impl verification 통과 / fast: impl 에이전트 완료 |

1. Gate를 통과하면(자율: 자동 / 게이트: 사용자 확인 후) **즉시 다음 phase 파일을 Read하여 실행**한다
2. phase 파일 끝의 `→ 다음: /orchestrate --only xxx` 안내는 **무시**한다 — 자동으로 진행한다
3. 어떤 phase에서든 STOP이 발생하면 전체 워크플로우를 중단하고 사용자에게 보고한다
4. **Phase 경계 compact** — 자율 모드에서는 요청하지 않고 자동 진행한다 (재개 컨텍스트는 state JSON에 영속). **게이트 모드에서만** 각 phase 완료 후 다음 phase 파일을 Read하기 전에 `/compact` 실행을 요청하고 대기한다 (Gate 경계는 승인 메시지에 함께 포함, Gate 없는 경계(impl→done)는 verification 통과 보고 시 요청). 사용자가 건너뛰겠다고 명시하면 생략한다

## Resuming Mid-Workflow (개별 phase)

`--only <phase>`가 있으면 `~/.claude/skills/orchestrate/phases/<phase>.md` 하나만 Read해 수행하고 종료한다 (자동 연속 실행 아님). 모든 재개 컨텍스트는 state JSON에서 로드한다. state의 `currentPhase`가 이미 지난 phase를 다시 실행하려 하면 "이미 {phase}가 완료되었습니다. 다시 실행할까요?"를 확인한다. 기존 state와 identifier가 겹치는 경우의 처리는 [start.md](phases/start.md) §0을 따른다.

## Cleanup (산출물 정리)

완료·중단된 워크플로우의 산출물(worktree, 로컬·원격 브랜치, plan·state 파일, 테스트 DB)은 `/orchestrate --only cleanup`으로 일괄 정리한다. 안전성 검사를 통과한 안전 대상만 자동으로 삭제하고, 나머지는 **미리보기 + 승인**을 거쳐서만 삭제한다. 상세: `~/.claude/skills/orchestrate/phases/cleanup.md` (파이프라인 phase 아님 — 단독 실행)

## Examples

```
/orchestrate add voucher notification                  # worktree + 자율 모드 (기본) — 무인 진행 → PR. 애매/중대 사항만 질문
/orchestrate --gated add voucher                       # worktree + 게이트 모드 — 각 게이트에서 승인 요청
/orchestrate --main add dashboard page                 # main 모드 — 게이트 승인 방식 + commit까지
/orchestrate --fast fix typo in error message          # fast — review 스킵, 검증 1회, 단일 커밋 → 최단 경로로 PR
/orchestrate --fast --gated tweak button color         # fast + 게이트 승인 (두 축은 직교하므로 조합 가능)
/orchestrate --main --fast bump dependency version     # main + fast — 게이트 승인 방식 + commit까지, 단계는 축약
```
