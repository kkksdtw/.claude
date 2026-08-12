---
description: Start orchestrate workflow. Requirements Q&A → workspace setup → plan writing.
---

# Start Orchestrate

## 0. Idempotency Check

1. 현재 repo의 `plans/*.state.json`을 Glob으로 검색한다
2. 동일하거나 유사한 identifier의 state가 존재하면:
   - AskUserQuestion: "기존 워크플로우({identifier}, phase: {currentPhase})를 이어서 진행할까요, 새로 시작할까요?"
   - 이어서 진행 → state의 `currentPhase`에 해당하는 sub-command로 재개
   - 새로 시작 → 기존 state 파일 삭제 후 계속
3. worktree 모드(기본)면 `git worktree list`로 동일 identifier의 worktree도 확인한다
4. 매칭되는 것이 없으면 → 정상 진행

## 0.5. Speed 판별 (`--fast`)

명령 입력에 `--fast`가 있으면 `speed = "fast"`, 없으면 `"normal"`이다. 이 값은 **이후 모든 단계의 축소 여부를 결정**하므로 Q&A보다 먼저 확정한다. 상세 대조표: [Speed Mode](../orchestrate.md#speed-mode---fast).

`speed = "fast"`일 때 이 phase에서 달라지는 것:

| 단계 | normal | fast |
|------|--------|------|
| §1 Q&A | 최대 2라운드 | **최대 1라운드** — 추론 가능하면 생략 |
| §4d 플랜 | 7개 섹션 | **3개 섹션 축약** |
| §4e Gate 1 통과 후 | review phase | **impl phase로 직행** |

**fast 부적합 판정** — 사용자 요청에 아래가 포함되면 fast를 쓰지 말 것을 **1줄 경고하고 AskUserQuestion으로 확인**받는다 (사용자가 그대로 진행을 택하면 fast로 계속한다):

- 스키마 마이그레이션 / auth·authz 변경 / 외부 API 계약 변경 → 플랜 단계 리뷰가 실제로 값어치를 하는 영역
- 요구사항이 애매해 해석이 갈림 → 잘못된 플랜으로 직행하면 fast가 오히려 느리다

## 1. Requirements Q&A

사용자와 인터랙티브 인터뷰를 진행한다. 목표: 구현에 필요한 최소한의 명확한 요구사항 확보.

**AskUserQuestion 도구**로 프로젝트 타입에 따라 관련 항목만 선별하여 질문한다 (1회에 1~3개 질문, **normal 최대 2회 / fast 최대 1회**):

| 프로젝트 타입 | 필수 확인 항목 |
|---------------|----------------|
| Backend API | endpoint spec (method, path, request/response), validation rules, error scenarios |
| Frontend UI | 컴포넌트 구조, 상태 관리, UX 요구사항 |
| Fullstack | API contract + 화면 흐름 |
| 공통 | 목적과 사용자 가치, 외부 서비스 연동 여부 |

**종료 조건:**
- 사용자가 "진행해", "충분해" 등 명시적으로 종료 의사를 밝히면 즉시 종료
- 필수 항목이 모두 확인되면 종료
- 사용자가 간략한 답변을 해도 추론 가능하면 그대로 진행 (과도한 질문 금지)

> **자율 모드에서도 이 Q&A는 축소하지 않는다.** 자율 진행은 게이트 승인을 생략할 뿐, 요구사항 명확화는 그대로 유지한다. 필수 스펙이 없거나 여러 해석이 가능해 구현이 실질적으로 달라지는 항목은 [에스컬레이션 조건](../orchestrate.md#autonomy-mode-게이트-자동-통과-vs-승인) 1번에 따라 반드시 질문한다.
>
> **fast 모드는 라운드 수만 1회로 줄인다 — 에스컬레이션 조건 1번은 그대로다.** 1라운드 안에 필수 스펙이 확보되지 않으면 라운드를 늘리지 말고, 애매한 항목을 그 자리에서 질문한다. fast는 *묻는 횟수*를 줄이는 것이지 *모른 채 진행하는 것*이 아니다.

**출력:** 구조화된 요구사항 문서 (plan 작성에 사용)

## 2. Identifier 결정

feature 요약에서 kebab-case slug를 생성한다 (예: `add-dashboard`, `voucher-notification`).
이 값이 state의 `identifier`이자, worktree 모드의 브랜치명이 된다.

## 3. Workspace Setup

**Workspace 판별** — 플래그로 모드를 정한다: **플래그 없음 → worktree (기본)**, `--main` → main.

**Autonomy 결정** ([orchestrate.md](../orchestrate.md#autonomy-mode-게이트-자동-통과-vs-승인) 기준) — workspace와 플래그로 `autonomy`를 확정해 state에 기록한다:

| workspace | `--gated` | autonomy |
|-----------|:---------:|----------|
| worktree (기본) | 없음 | `auto` (게이트 자동 통과) |
| worktree (기본) | 있음 | `gated` |
| main (`--main`) | 무관 | `gated` (자율 모드는 worktree 전용) |

> `speed`는 §0.5에서 이미 확정됐다 — `--fast`는 위 표에 영향을 주지 않는다 (두 축은 직교).

> 기본 경로는 **worktree 모드**다. 아래 두 절 중 해당하는 모드의 절차를 수행한다.

### main 모드 (`--main` 플래그)

워크스페이스를 만들지 않는다. **현재 체크아웃에서 그대로 개발한다.**

```bash
WORK_PATH=$(git rev-parse --show-toplevel)
git status --porcelain
```

- `workspace = "main"`, `branchName = null`, `workPath = WORK_PATH`, `worktreeCreated = false`, **`autonomy = "gated"`**
- 자율 모드는 worktree 전용이다. `--main`으로 실행하면 **"main 모드는 게이트 승인 방식으로 진행합니다. 무인 진행(→ PR)이 필요하면 플래그 없이(기본 worktree) 실행하세요"**를 1줄 안내한다 ([safety.md](../../rules/devops/safety.md) §4 — 실제 main/master 직접 commit 방지).
- working tree에 **기존 변경사항이 있으면** 사용자에게 알리고 진행 여부를 확인한다 — orchestrate의 변경분과 섞여 커밋 범위가 오염되는 것을 방지

### worktree 모드 (기본 — 플래그 없음)

**먼저 실행 위치가 이미 linked worktree인지 감지한다.** 이미 worktree 안이면 **새로 만들지 않고 채택한다**(worktree 중첩 방지).

```bash
CURRENT_TOP=$(git rev-parse --show-toplevel)
MAIN_TOP=$(git worktree list | head -1 | awk '{print $1}')   # main 작업 트리는 항상 목록 첫 줄
[ "$CURRENT_TOP" != "$MAIN_TOP" ] && echo "ADOPT" || echo "CREATE"
```

| 결과 | 의미 | 경로 |
|------|------|------|
| `ADOPT` | 이미 linked worktree 안에서 실행 중 | **3-A. 채택** — 새 worktree 생성 안 함, gtr 불필요 |
| `CREATE` | main 작업 트리에서 실행 중 | **3-B. 생성** — gtr로 새 worktree |

#### 3-A. 기존 worktree 채택 (ADOPT)

새 worktree를 만들지 않는다. 현재 worktree를 그대로 workspace로 쓰고, **브랜치는 현재 브랜치를 그대로 사용한다** — identifier로 브랜치를 새로 만들지 않는다.

```bash
WORK_PATH="$CURRENT_TOP"
BRANCH_NAME=$(git branch --show-current)
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
```

- 결과 기록: `workspace = "worktree"`, `branchName = $BRANCH_NAME`, `workPath = $WORK_PATH`, **`worktreeCreated = false`** (orchestrate가 만든 게 아니므로 cleanup이 제거하지 않는다).
- **안전 가드:**
  - `BRANCH_NAME`이 비어 있으면(detached HEAD) → **STOP**: "현재 worktree가 detached HEAD입니다. feature 브랜치를 체크아웃한 뒤 다시 실행하세요."
  - `BRANCH_NAME == DEFAULT_BRANCH`(base 브랜치 위의 worktree)면 자율 자동 커밋이 base 브랜치를 오염시킬 수 있다([safety.md](../../rules/devops/safety.md) §4) → **에스컬레이션**: AskUserQuestion으로 "① 다른 feature 브랜치를 만들어 진행 / ② 게이트 승인 방식(`gated`)으로 이 브랜치에서 진행 / ③ 중단" 중 선택받는다. (에스컬레이션이므로 [발화 규율](../orchestrate.md#output-discipline-발화-규율)의 발화 허용 시점이다.)
- identifier(§2)는 state·plan 파일명에만 쓰고, 브랜치명으로는 쓰지 않는다.

#### 3-B. 새 worktree 생성 (CREATE)

> **CRITICAL: gtr은 Git subcommand다. 반드시 `git gtr`로 실행해야 한다. `gtr` 단독 실행은 command not found.**

```bash
# CORRECT — 반드시 이 형태로 실행
git gtr list 2>/dev/null && echo "GTR_AVAILABLE" || echo "GTR_NOT_AVAILABLE"

# WRONG — 절대 이렇게 실행하지 않는다
# gtr list                    ← command not found
```

| 결과 | 행동 |
|------|------|
| `GTR_AVAILABLE` | worktree 생성 진행 |
| `GTR_NOT_AVAILABLE` | **STOP**: "gtr(git-worktree-runner)이 설치되어 있지 않습니다. 설치 후 다시 실행하거나, `--main`으로 main 모드(게이트 승인, commit까지)로 진행하세요" |

아래 명령어를 **정확히 이 순서로, 이 형태 그대로** 실행한다:

```bash
# 1. 브랜치명 = identifier
BRANCH_NAME="{identifier}"

# 2. worktree 생성 — 반드시 "git gtr" 형태로 실행
git gtr new "$BRANCH_NAME"

# 3. worktree 경로 획득
WORK_PATH=$(git worktree list | grep "$BRANCH_NAME" | awk '{print $1}')

# 4. worktree 진입 및 검증
cd "$WORK_PATH"
[ "$(git branch --show-current)" = "$BRANCH_NAME" ] || echo "ERROR: worktree 진입 실패"
```

- 결과 기록: `workspace = "worktree"`, `branchName = $BRANCH_NAME`, `workPath = $WORK_PATH`, **`worktreeCreated = true`**.

**자동 실행 항목** (수동 실행 불필요):
- `.gtrconfig`의 `[copy]` 패턴에 매칭되는 `.env` 파일 복사
- `[hooks] postCreate` 명령어 실행 (예: `pnpm install --frozen-lockfile`)

**반드시 worktree에 진입하고 브랜치를 검증한 후** 다음 단계로 진행한다.
이후 모든 작업(plan 작성, 파일 편집)은 worktree 안에서 수행한다.

**이미 동일 브랜치의 worktree가 존재하는 경우:**
- AskUserQuestion: "이미 {BRANCH_NAME} worktree가 존재합니다. 해당 worktree를 사용할까요?"
- 예 → 기존 worktree 경로로 cd (그 worktree를 채택 — `worktreeCreated = false`)
- 아니오 → STOP

## 4. Write Plan + State (workPath 안에서)

**먼저 plans/ 디렉토리 생성:**
```bash
mkdir -p plans/
```

> plan·state 파일은 워크플로우 메타데이터다. **커밋에 포함하지 않는다.**

### 4a. Project Context 추출

프로젝트 CLAUDE.md는 Claude Code가 자동 로드하므로 이미 컨텍스트에 있다. 아래 값을 추출하여 state JSON에 저장한다:

1. **projectType**: CLAUDE.md의 Tech Stack / Overview를 보고 판별
   - NestJS, Express, Django, Gin 등 → `"backend"`
   - Next.js, React, Vue 등 → `"frontend"`
   - 양쪽 모두 → `"fullstack"`
   - 판별 불가 → 프로젝트 루트에서 파일 감지 (`nest-cli.json` → backend, `next.config.*` → frontend 등)
   - 그래도 불가 → AskUserQuestion으로 사용자에게 질문

2. **techStack**: CLAUDE.md에서 추출한 프레임워크 / 언어 조합 (예: `"NestJS / TypeScript"`)

3. **commands**: CLAUDE.md의 `## Commands` 섹션에서 lint, build, test 명령어 추출
   - 모노레포인 경우 작업 대상 패키지의 per-package CLAUDE.md에서 추출
   - 명령어를 찾을 수 없으면 → AskUserQuestion으로 사용자에게 직접 질문

4. **patternAnchors**: 이번 작업과 **같은 형태로 이미 구현된 기존 코드** 경로를 3~5개 뽑는다.

   구현 에이전트의 소요 시간은 파일 수보다 **"이 프로젝트에서 이걸 어떻게 쓰는지 찾는 고정비"**가 지배한다(실측: 에이전트당 약 12분). 에이전트마다 같은 탐색을 반복하므로 이 비용은 에이전트 수만큼 곱해진다. 여기서 한 번 찾아 플랜에 박아두면 그 곱셈이 사라진다.

   - 요구사항의 각 축(예: 목록 조회 / 등록·수정 / 엑셀 처리)마다 **가장 가까운 기존 구현 1개**를 Glob/Grep으로 찾는다.
   - 레이어별로 전부 나열하지 말고, 에이전트가 **읽고 그대로 따라할 수 있는 대표 파일**을 고른다 — 보통 use case 1개 + repository 1개 + 테스트 1개면 충분하다.
   - 각 경로에 "무엇의 기준인지"를 한 줄로 붙인다. 경로만 주면 왜 읽어야 하는지 몰라 결국 다시 탐색한다.
   - 정말 선례가 없는 신규 영역이면 빈 배열로 두고 플랜에 "선례 없음"이라고 적는다. **억지로 비슷하지 않은 파일을 넣지 않는다** — 잘못된 앵커는 탐색보다 나쁘다.

   ```jsonc
   "patternAnchors": [
     { "path": "src/coupon/application/list.usecase.ts", "role": "목록 조회 + 페이지네이션 기준" },
     { "path": "src/coupon/infra/coupon.read.repository.ts", "role": "read repository 쿼리 패턴" },
     { "path": "test/coupon.e2e-spec.ts", "role": "E2E 테스트 구조·픽스처 기준" }
   ]
   ```

### 4b. Base Branch 감지

```bash
git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'
```
출력이 있으면 그 값을 사용 (예: `main`, `develop`). 출력이 없으면 `"main"`을 기본값으로 사용.

### 4c. State JSON — `plans/{identifier}.state.json`

**가장 먼저 생성.** 모든 에이전트가 읽는 single source of truth.

Write 도구로 아래 JSON을 생성한다 (모든 필드를 채울 것):

```jsonc
{
  "identifier": "{slug}",
  "workspace": "{main | worktree}",
  "branchName": "{worktree 생성: identifier / worktree 채택: 현재 브랜치 / main 모드: null}",
  "worktreeCreated": {worktree 생성: true / worktree 채택: false / main 모드: false},
  "baseBranch": "{4b에서 감지한 값}",

  "workPath": "{step 3에서 획득한 절대 경로}",
  "planFile": "{workPath}/plans/{identifier}.md",

  "projectType": "{backend | frontend | fullstack}",
  "techStack": "{프레임워크 / 언어}",
  "commands": {
    "lint": "{lint 명령어}",
    "build": "{build 명령어}",
    "test": "{test 명령어}"
  },

  // 4a step 4 — 구현 에이전트가 탐색 대신 읽고 따라할 기존 구현. 선례 없으면 []
  "patternAnchors": [
    { "path": "{기존 구현 경로}", "role": "{무엇의 기준인지 한 줄}" }
  ],

  "currentPhase": "start",
  "autonomy": "{auto | gated — step 3의 Autonomy 결정 표}",
  "speed": "{normal | fast — step 0.5의 Speed 판별}",
  "gates": {
    "plan": false,
    "review": false,          // fast 모드면 "skipped" (review phase가 없다)
    "finish": false
  },

  "expertReviews": {},

  "attempts": {
    "planFix": 0,
    "implVerify": 0,
    "codeFix": 0,
    "doneVerify": 0
  },

  "testDatabase": {          // 프로토콜: rules/common/test-db-isolation.md
    "name": null,            // 워크플로우 전용 DB 이름 (impl/done에서 생성)
    "template": null,        // 재사용 중인 템플릿 DB (마이그레이션 1회분 캐시 — cleanup 대상 아님)
    "type": null,            // postgresql | mysql | sqlite | mongodb
    "migrate": null          // 캐시된 마이그레이션 명령 — 매 워크플로우 재탐색 방지
  },                         // URL 필드를 두지 않는다 — credential이 디스크에 남는다

  "verification": {
    "lint": null,
    "build": null,
    "test": null,
    "lastRunAt": null
  },
  "implVerifiedClean": false,  // impl 전체 검증 통과 + 이후 편집 없음일 때만 true. 초기값은 반드시 false

  "pullRequest": {
    "url": null,
    "number": null
  },

  "createdAt": "{현재 ISO 8601 — date -u +%Y-%m-%dT%H:%M:%SZ}",
  "updatedAt": "{현재 ISO 8601}"
}
```

### 4d. Plan Markdown — `plans/{identifier}.md`

Write 도구로 사람이 읽는 플랜 문서를 생성한다. **`speed` 값에 따라 분량이 갈린다.**

**normal — 7개 섹션 풀 문서:**

1. **Workspace** — 모드(main/worktree) + 브랜치명
2. **Tech Stack** — 프로젝트 기술 스택 요약
3. **Requirements** — step 1에서 정리한 요구사항 요약
4. **Affected Layers** — CLAUDE.md의 아키텍처 정보 기반
5. **Implementation Phases** (반드시 이 정확한 헤딩명 사용) — phase별 작업 항목 + 병렬/순차 표시 + 에이전트 배정 테이블
6. **Risk Assessment** — 주의할 점, 의존성, 잠재 이슈
7. **Status** — "Plan ready — proceed with `/orchestrate:review`"

**fast — 3개 섹션 축약:**

1. **Requirements** — step 1에서 정리한 요구사항 (불릿 몇 줄)
2. **Implementation Phases** (반드시 이 정확한 헤딩명 사용) — impl phase가 이 섹션을 파싱하므로 **normal과 동일한 구조를 유지한다.** 작업 항목 + 병렬/순차 + 에이전트 배정
3. **Risk Assessment** — 한 줄. 없으면 "없음"

Workspace·Tech Stack·Affected Layers는 생략한다 — 앞의 둘은 state JSON에 이미 있고, Affected Layers는 fast가 대상으로 하는 작은 변경에서 Implementation Phases와 사실상 중복이다. Status는 `"Plan ready — review skipped (fast), proceed with /orchestrate:impl"`로 적는다.

> **Implementation Phases는 fast에서도 축약하지 않는다.** impl phase가 이 섹션에서 에이전트 배정을 추출한다 — 여기가 부실하면 구현이 어긋나고, 재작업 비용이 절약분을 넘는다.

#### Implementation Phases 작성 규칙

phase 내 에이전트는 **동시에 출발해 가장 느린 하나가 끝나야 다음 phase로 간다.** 그래서 배정이 기울면 먼저 끝난 에이전트가 그만큼 논다(실측: 8 : 23 : 35파일 배분에서 최소 담당 에이전트가 12분 37초 유휴). 배정은 논리적 축이 아니라 **크기**로 맞춘다.

배정 테이블에 **에이전트별 예상 파일 수를 반드시 적는다.** 적지 않으면 기울었는지 알 수 없다.

| 에이전트 | 담당 | 예상 파일 | 참조 앵커 |
|---|---|---|---|
| A1 | ... | 12 | `4a의 patternAnchors 중 이 에이전트가 읽을 것` |

**균형 규칙:**

- **최대 / 최소 ≤ 2배.** 넘으면 가장 큰 배정을 쪼갠다. 쪼갤 때는 이미 파일이 분리된 경계를 쓴다(read/write repository, 조회/변경 use case 등) — 그런 경계가 없으면 쪼개지 말고 그대로 둔다. 충돌 처리 비용이 절약분을 먹는다.
- **에이전트당 18파일 상한.** 넘으면 분할 후보다.
- **phase당 3~5명.** 에이전트마다 프로젝트 파악 고정비(약 12분)가 붙으므로 6명 이상으로 쪼개도 벽시계가 더 줄지 않는다. 5명을 넘겨야 할 만큼 크면 phase를 나누는 편이 낫다.

**앵커 매핑:** 4a에서 뽑은 `patternAnchors`를 각 에이전트에 나눠 배정한다. impl phase가 이 매핑을 에이전트 프롬프트에 그대로 넣어 "패턴 찾기"를 "패턴 읽기"로 바꾼다. 앵커가 없는 에이전트는 비워둔다.

> 경로 등 메타데이터는 plan markdown에 중복 기재하지 않는다. State JSON이 single source of truth.

### 4e. Gate 1 — Plan Confirmation

두 파일 작성 완료 후, **`autonomy` 값에 따라 분기**한다:

**자율 모드 (`auto`)** — [발화 규율](../orchestrate.md#output-discipline-발화-규율)에 따라 **플랜 요약을 출력하지 않고 즉시 자동 통과**해 다음 phase로 진행한다. "플랜을 승인할까요?" 같은 확인을 **묻지 않는다.** 단 요구사항이 애매하거나 [에스컬레이션 조건](../orchestrate.md#autonomy-mode-게이트-자동-통과-vs-승인)에 해당하면 멈추고 AskUserQuestion으로 질문한다.

**게이트 모드 (`gated`)**:
1. 플랜의 핵심 요약을 텍스트로 출력한다
2. AskUserQuestion으로 확인: "플랜을 승인하고 expert review로 진행할까요?"
   - 승인 → state 갱신 후 다음 phase 진행
   - 수정 요청 → 사용자 피드백 반영 후 재확인

통과(자동 또는 승인)하면 → state JSON을 Read → **`speed` 값에 따라** 아래 필드 갱신 → Write:

**normal** — review phase로 진행:
```jsonc
{
  "gates": { "plan": true },
  "currentPhase": "review",
  "updatedAt": "{현재 ISO 8601}"
}
```

**fast** — review phase를 건너뛰고 impl로 직행:
```jsonc
{
  "gates": { "plan": true, "review": "skipped" },
  "currentPhase": "impl",
  "updatedAt": "{현재 ISO 8601}"
}
```

> fast에서는 `~/.claude/commands/orchestrate/review.md`를 **Read하지 않는다.** 곧바로 `impl.md`를 Read해 실행한다. **자율 모드에서는 스킵 사실을 발화하지 않는다** ([발화 규율](../orchestrate.md#output-discipline-발화-규율)) — 완료 보고의 참고사항에 반영한다. 게이트 모드에서는 다음 Gate 프롬프트에 함께 적는다.

## Done Criteria

아래 조건이 **모두** 충족되어야 이 phase가 완료된 것이다:

- [ ] 요구사항이 명확하게 정리됨
- [ ] Workspace 확인 완료 — main 모드: repo 루트 + working tree 상태 확인 / worktree 생성: gtr 생성 + 진입 + 브랜치 일치 / worktree 채택: 현재 worktree·브랜치 확인 (새 worktree 미생성)
- [ ] `plans/{identifier}.state.json` 생성, 모든 필드 값이 채워짐 (`speed`·`worktreeCreated` 포함)
- [ ] `plans/{identifier}.md` 작성 — normal: 7개 섹션 / fast: 3개 섹션. 어느 쪽이든 **Implementation Phases에 에이전트 배정 포함**
- [ ] Gate 1 통과 — 자율 모드: 확인 없이 자동 진행 / 게이트 모드: 사용자가 플랜 확인
- [ ] fast 모드: `gates.review = "skipped"`, `currentPhase = "impl"`로 기록됨

> `/orchestrate`로 실행 중이면 자동으로 다음 phase로 진행한다 — **normal: review / fast: impl**.
> 단독 실행(`/orchestrate:start`)이면 사용자에게 안내: normal은 `/orchestrate:review`, fast는 `/orchestrate:impl`.
