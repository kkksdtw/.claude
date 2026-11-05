---
description: Clean up orchestrate artifacts. Worktree, local/remote branch, plan/state files, test DB — preview and confirm before deletion.
---

# Cleanup Orchestrate Artifacts

orchestrate가 만든 산출물(worktree, 로컬·원격 브랜치, plan·state 파일, 테스트 DB)을 정리한다.
파이프라인 phase가 아니다 — 필요할 때 단독 실행한다.

**발견·검사 단계는 읽기 전용이다.** 삭제는 §1.5의 안전 대상만 자동으로 실행하고, 나머지는 미리보기 + 사용자 승인(§2) 후에만 실행한다.

## 0. Discover (읽기)

**cleanup은 실행된 현재 worktree(= 자기 자신)만 정리한다.** `git worktree list`로 다른 worktree를 순회하거나 조사하지 않는다. 이후 §1~§4의 "대상"은 항상 이 현재 worktree 하나를 가리킨다.

1. **자기 자신 식별** — worktree 제거는 그 내부에서 실행할 수 없으므로 main repo 경로도 함께 잡아둔다(삭제 실행 위치용):
   ```bash
   SELF_WORKTREE=$(git rev-parse --show-toplevel)               # 정리 대상 = 현재 worktree
   MAIN_REPO=$(git worktree list | head -1 | awk '{print $1}')  # worktree 제거를 실행할 위치
   ```
2. **대상 수집** — `{SELF_WORKTREE}/plans/*.state.json`만 읽는다.
3. state를 Read로 파싱: `identifier`, `workspace`, `worktreeCreated`, `branchName`, `baseBranch`, `currentPhase`, `pullRequest`, `testDatabase`, `workPath`
4. **대상 유형 판별** — 이후 모든 절은 이 구분을 따른다:
   - **생성 worktree** (`workspace == "worktree"`, `worktreeCreated == true`): worktree·로컬·원격 브랜치·파일·테스트 DB 모두 정리 후보다.
   - **파일 전용 대상**: main 모드 잔재(`SELF_WORKTREE == MAIN_REPO`)와 **채택 worktree**(`workspace == "worktree"`, `worktreeCreated == false`). 채택 worktree는 사용자가 만든 것이므로 **worktree·로컬·원격 브랜치를 삭제 대상에서 제외**한다. 두 경우 모두 plan·state 파일과 테스트 DB만 정리한다.
5. 현재 worktree에 state가 없으면 → "이 worktree에는 정리할 orchestrate 산출물이 없습니다" 보고 후 종료. 다른 worktree를 뒤지지 않는다.

> state 없이 브랜치만 남은 잔재는 orchestrate 소속임을 단정할 수 없다 — 발견되면 목록만 보여주고 삭제 대상에 자동 포함하지 않는다.

## 1. Inspect (삭제 안전성 평가 — 읽기)

대상에 대해 확인하고 결과를 표로 정리한다. 파일 전용 대상은 진행 중 여부·테스트 DB 행만 해당된다.

| 항목 | 확인 | 경고 조건 |
|------|------|----------|
| 진행 중 여부 | state의 `currentPhase` | `"completed"`가 아니면 ⚠️ 작업 중인 워크플로우 |
| 미커밋 변경 | `git -C {workPath} status --porcelain` | 출력 있으면 ⚠️ 작업 유실 위험 |
| 미push 커밋 | `git log --oneline origin/{branchName}..{branchName}` (원격 없으면 `{baseBranch}..{branchName}`) | 출력 있으면 ⚠️ push 안 된 커밋 유실 |
| PR 상태 | `gh pr view {pullRequest.number} --json state --jq .state` (PR 있으면) | `OPEN`이면 ⚠️ 원격 브랜치 삭제 시 PR이 닫힘 |
| 원격 브랜치 존재 | `git ls-remote --heads origin {branchName}` | 존재하면 원격 삭제 후보 |
| 테스트 DB 잔존 | state의 `testDatabase.name` ≠ null | drop 후보 |
| 템플릿 DB | state의 `testDatabase.template` | **drop 후보 아님** — 다음 워크플로우가 재사용하는 마이그레이션 캐시 |

## 1.5 Classify & Auto-delete (안전 대상 자동 정리)

대상을 **안전**과 **경고**로 분류한다. **안전 대상은 사용자 승인 없이 즉시 삭제**하고, 경고 대상만 §2 GATE로 넘긴다.

### 안전 판정 (생성 worktree만 — 아래 4개를 모두 충족해야 안전)

1. `currentPhase == "completed"`
2. 미커밋 변경 없음 — `git -C {workPath} status --porcelain` 출력이 비어 있음
3. 미push 커밋 없음 — `git -C {workPath} log --oneline origin/{branchName}..{branchName}` 출력이 비어 있음
4. PR이 존재하고 상태가 `MERGED` — `gh pr view {pullRequest.number} --json state --jq .state` == `MERGED`

> 하나라도 어긋나면(진행 중·미커밋·미push·OPEN/미병합 PR·PR 없음) **경고 대상**으로 분류해 §2로 넘긴다. 파일 전용 대상과 state 없는 브랜치 잔재도 이 자동 경로가 아니라 §2로 처리한다.

### 안전 대상 자동 삭제 (승인 불필요)

**PR이 MERGED이므로 원격 브랜치 삭제까지 안전에 포함**한다.

```bash
cd "$MAIN_REPO"
# 1. 테스트 DB (잔존 시) — testDatabase.type에 맞는 drop 명령 (|| true)
# 2. worktree + 로컬 브랜치 — 반드시 git gtr로 (worktreeCreated == true 확인됨)
git gtr rm {branchName} --delete-branch      # 실패 시 fallback: git worktree remove {workPath} && git branch -D {branchName}
git worktree prune
# 3. 원격 브랜치 (MERGED 확인됨)
git push origin --delete {branchName}
```

> plan·state 파일은 worktree 안에 있으므로 worktree 제거와 함께 사라진다. 삭제한 항목을 기록해 §4에서 **자동 삭제분**으로 보고한다.

## 2. Plan & Confirm (경고 대상만 — GATE)

§1.5 이후 **경고(⚠️)가 있는 대상이 남아 있을 때만** 이 GATE를 수행한다. 남은 대상이 없으면 §2·§3을 건너뛰고 §4로 간다.

**STOP.** 정리 계획을 출력한다:

```
{identifier} ({workspace} 모드, phase: {currentPhase})
  삭제 대상:
  - worktree: {workPath}            (생성 worktree만)
  - 로컬 브랜치: {branchName}        (생성 worktree만)
  - 원격 브랜치: origin/{branchName} (생성 worktree, 존재 시)
  - 파일: plans/{identifier}.md, plans/{identifier}.state.json
  - 테스트 DB: {testDatabase.name}   (잔존 시)
  경고: {⚠️ 항목들 — 없으면 "없음"}
```

AskUserQuestion(multiSelect)으로 **무엇을 지울지** 항목별로 선택받는다:
- ⚠️가 있는 항목은 경고를 명시하고 기본 제외를 권고
- **원격 브랜치 삭제는 별도 선택지**로 분리한다 — 로컬 정리에 묶어 암묵적으로 지우지 않는다
- OPEN PR이 걸린 원격 브랜치는 선택지에서 제외하고 사유를 표시한다

## 3. Execute (§2에서 승인된 항목만, 순서대로)

### 3a. 테스트 DB (잔존 시)

`testDatabase.type`에 따라 [test-db-isolation.md](../references/test-db-isolation.md)의 Cleanup 명령을 **`testDatabase.name`에 대해서만** 실행한다 (`|| true`로 실패 무시).

> **템플릿 DB(`orch_tmpl_*`)는 삭제하지 않는다.** 지우면 다음 워크플로우가 전체 마이그레이션을 다시 돌린다. 사용자가 "템플릿까지 정리"를 **명시 요청**한 경우에만 `psql -lqt | grep orch_tmpl_` 목록을 보여주고 승인받아 삭제한다.

### 3b. 생성 worktree (`worktreeCreated == true`만 — 채택 worktree는 건너뛴다)

```bash
# 현재 위치가 삭제 대상 worktree 안이면 안 된다 — main repo 루트에서 실행
cd "$MAIN_REPO"

# 1. worktree + 로컬 브랜치 — 반드시 git gtr로
git gtr rm {branchName} --delete-branch

# 2. gtr 실패·미설치 시 fallback
git worktree remove {workPath} && git branch -D {branchName}

# 3. 잔여 메타데이터 정리
git worktree prune
```

plan·state 파일은 worktree와 함께 사라진다. **원격 브랜치는 사용자가 명시적으로 선택한 경우만** 삭제한다:
```bash
git push origin --delete {branchName}
```

### 3c. 파일 전용 대상 (main 모드 · 채택 worktree)

파일은 `workPath`의 `plans/`에 있다 — main 모드는 repo 루트, 채택 worktree는 그 worktree 루트. 채택 worktree는 현재 cwd(자기 worktree)에서 그대로 실행한다.

```bash
rm -f {workPath}/plans/{identifier}.md {workPath}/plans/{identifier}.state.json
rmdir {workPath}/plans 2>/dev/null || true    # 디렉토리가 비었으면 함께 제거
```

## 4. Verify & Report (읽기)

삭제 후 현재 worktree가 사라졌을 수 있으므로 `$MAIN_REPO`에서 확인한다. 채택 worktree는 worktree·브랜치가 의도적으로 남으므로 worktree/브랜치 확인을 건너뛰고 파일과 테스트 DB만 확인한다.

```bash
cd "$MAIN_REPO"
git worktree list | grep {branchName}      # (생성 worktree만) 자기 worktree가 제거됐는지 (출력 없어야 정상)
git branch --list {branchName}             # 로컬 브랜치 제거 확인
git ls-remote --heads origin {branchName}  # 원격 브랜치 제거 확인 (삭제한 경우)
ls plans/ 2>/dev/null                      # main 모드였다면 파일 제거 확인
```

항목별 결과를 보고하되, 각 항목이 **자동 삭제(§1.5)**와 **승인 삭제(§2)** 중 어느 경로로 정리됐는지 함께 밝힌다:

| 항목 | 결과 |
|------|------|
| worktree | 삭제됨 / 실패 / 건너뜀 |
| 로컬 브랜치 | 삭제됨 / 실패 / 건너뜀 |
| 원격 브랜치 | 삭제됨 / 건너뜀(미선택·OPEN PR) |
| plan·state 파일 | 삭제됨 / 건너뜀 |
| 테스트 DB | 삭제됨 / 없음 |

실패한 항목은 에러 출력을 그대로 보여주고 수동 정리 명령을 안내한다.

## Done Criteria

- [ ] 현재 worktree의 state 산출물만 발견·평가됨 (state가 없으면 즉시 종료)
- [ ] 채택 worktree는 worktree·로컬·원격 브랜치를 제거하지 않음
- [ ] 안전 대상만 자동 삭제, 경고 대상은 GATE에서 명시 승인 후 삭제
- [ ] 자동 삭제분·승인 삭제분을 구분해 항목별 성공/실패 보고
