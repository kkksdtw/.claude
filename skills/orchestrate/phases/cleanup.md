---
description: Clean up orchestrate artifacts. Worktree, local/remote branch, plan/state files, test DB — preview and confirm before deletion.
---

# Cleanup Orchestrate Artifacts

orchestrate가 만든 산출물(worktree, 로컬·원격 브랜치, plan·state 파일, 테스트 DB)을 정리한다.
파이프라인 phase가 아니다 — 필요할 때 단독 실행한다.

**모든 삭제는 미리보기 + 사용자 승인 후에만 실행한다. 발견·검사 단계는 읽기 전용이다.**

## 0. Discover (읽기)

**cleanup은 실행된 현재 worktree(= 자기 자신)만 정리한다. 다른 worktree의 작업은 조사·정리하지 않는다.**

1. **자기 자신 식별** — cleanup이 실행된 현재 worktree가 유일한 정리 대상이다. worktree 제거는 그 내부에서 실행할 수 없으므로 main repo 경로도 함께 잡아둔다(삭제 실행 위치용):
   ```bash
   SELF_WORKTREE=$(git rev-parse --show-toplevel)               # 정리 대상 = 현재 worktree
   MAIN_REPO=$(git worktree list | head -1 | awk '{print $1}')  # worktree 제거를 실행할 위치
   ```
2. **대상 수집 — 오직 현재 worktree의 state만** 읽는다. `git worktree list`로 **다른 worktree를 순회하지 않는다**:
   - `{SELF_WORKTREE}/plans/*.state.json`
3. state를 Read로 파싱: `identifier`, `workspace`, `worktreeCreated`, `branchName`, `baseBranch`, `currentPhase`, `pullRequest`, `testDatabase`, `workPath`
   - `SELF_WORKTREE == MAIN_REPO`이면 현재 위치가 main repo다 → 자기 자신은 main 모드 잔재(파일·DB)뿐이다 (worktree·브랜치 없음). 이때도 다른 worktree는 건드리지 않는다.
   - **채택 worktree 판별**: `workspace == "worktree"`이고 `worktreeCreated == false`이면 orchestrate가 만든 worktree가 아니라 **사용자가 만든 worktree를 채택한 것**이다 → **worktree·로컬 브랜치·원격 브랜치를 삭제 대상에서 제외**한다(사용자 소유). plan·state 파일과 테스트 DB만 정리한다 — 즉 이 대상은 아래 §1.5/§3에서 **main 모드 잔재와 동일하게** 취급한다.
4. 현재 worktree에 state가 없으면 → "이 worktree에는 정리할 orchestrate 산출물이 없습니다" 보고 후 종료. **다른 worktree를 뒤지지 않는다.**

> 단일 대상 원칙: 이후 §1~§4의 "대상"은 항상 이 현재 worktree 하나를 가리킨다.
> state 없이 브랜치만 남은 잔재는 orchestrate 소속임을 단정할 수 없다 — 발견되면 목록만 보여주고 삭제 대상에 자동 포함하지 않는다.

## 1. Inspect (삭제 안전성 평가 — 읽기)

각 대상에 대해 확인하고 결과를 표로 정리한다:

| 항목 | 확인 (worktree 모드) | 경고 조건 |
|------|---------------------|----------|
| 진행 중 여부 | state의 `currentPhase` | `"completed"`가 아니면 ⚠️ 작업 중인 워크플로우 |
| 미커밋 변경 | `git -C {workPath} status --porcelain` | 출력 있으면 ⚠️ 작업 유실 위험 |
| 미push 커밋 | `git log --oneline origin/{branchName}..{branchName}` (원격 없으면 `{baseBranch}..{branchName}`) | 출력 있으면 ⚠️ push 안 된 커밋 유실 |
| PR 상태 | `gh pr view {pullRequest.number} --json state --jq .state` (PR 있으면) | `OPEN`이면 ⚠️ 원격 브랜치 삭제 시 PR이 닫힘 |
| 원격 브랜치 존재 | `git ls-remote --heads origin {branchName}` | 존재하면 원격 삭제 후보 |
| 테스트 DB 잔존 | state의 `testDatabase.name` ≠ null | drop 후보 |
| 템플릿 DB | state의 `testDatabase.template` | **drop 후보 아님** — 다음 워크플로우가 재사용하는 마이그레이션 캐시 |

main 모드 대상, 그리고 **채택 worktree(`worktreeCreated == false`)** 대상은 plan·state 파일과 testDatabase만 해당된다 (worktree·브랜치·원격 브랜치는 삭제 대상이 아니다 — 후자는 사용자 소유).

## 1.5 Classify & Auto-delete (안전 대상 자동 정리)

각 대상을 **안전**과 **경고**로 분류한다. **안전 대상은 사용자 승인 없이 즉시 삭제**하고, 경고 대상만 §2 GATE로 넘긴다.

### 안전 판정 (orchestrate가 생성한 worktree — `worktreeCreated == true` — 아래 4개를 모두 충족해야 안전)

1. `currentPhase == "completed"`
2. 미커밋 변경 없음 — `git -C {workPath} status --porcelain` 출력이 비어 있음
3. 미push 커밋 없음 — `git -C {workPath} log --oneline origin/{branchName}..{branchName}` 출력이 비어 있음
4. PR이 존재하고 상태가 `MERGED` — `gh pr view {pullRequest.number} --json state --jq .state` == `MERGED`

> 하나라도 어긋나면(진행 중·미커밋·미push·OPEN/미병합 PR·PR 없음) **경고 대상**으로 분류해 §2로 넘긴다.
> state 없이 브랜치만 남은 잔재, main 모드 잔재(파일·DB), **채택 worktree(`worktreeCreated == false`)** 는 이 worktree-삭제 자동 경로의 대상이 아니다 — §2 GATE로 처리한다. 채택 worktree는 애초에 worktree·브랜치를 지우지 않으므로, 남는 정리 대상은 plan·state 파일과 테스트 DB뿐이다.

### 안전 대상 자동 삭제 (승인 불필요)

`worktreeCreated == true`이고 4개 조건을 모두 충족한 대상만 아래를 실행한다. **PR이 MERGED이므로 원격 브랜치 삭제까지 안전에 포함**한다.

```bash
cd "$MAIN_REPO"
# 1. 테스트 DB (잔존 시) — testDatabase.type에 맞는 drop 명령 (|| true)
# 2. worktree + 로컬 브랜치 — 반드시 git gtr로 (worktreeCreated == true 확인됨)
git gtr rm {branchName} --delete-branch      # 실패 시 fallback: git worktree remove {workPath} && git branch -D {branchName}
git worktree prune
# 3. 원격 브랜치 (MERGED 확인됨)
git push origin --delete {branchName}
```

> plan·state 파일은 worktree 안에 있으므로 worktree 제거와 함께 사라진다.
> 삭제한 항목을 기록해 §4에서 **자동 삭제분**으로 보고한다.

## 2. Plan & Confirm (경고 대상만 — GATE)

§1.5에서 자동 삭제된 안전 대상을 제외하고, **경고(⚠️)가 있는 대상이 남아 있을 때만** 이 GATE를 수행한다. 남은 대상이 없으면 §2·§3을 건너뛰고 §4로 간다.

**STOP.** 남은 대상별 정리 계획을 출력한다:

```
{identifier} ({workspace} 모드, phase: {currentPhase})
  삭제 대상:
  - worktree: {workPath}            (worktree 모드)
  - 로컬 브랜치: {branchName}        (worktree 모드)
  - 원격 브랜치: origin/{branchName} (존재 시)
  - 파일: plans/{identifier}.md, plans/{identifier}.state.json
  - 테스트 DB: {testDatabase.name}   (잔존 시)
  경고: {⚠️ 항목들 — 없으면 "없음"}
```

AskUserQuestion(multiSelect)으로 **무엇을 지울지** 선택받는다 (대상은 현재 worktree 하나뿐이므로 항목별로 선택):
- ⚠️가 있는 항목은 경고를 명시하고 기본 제외를 권고
- **원격 브랜치 삭제는 별도 선택지**로 분리한다 — 로컬 정리에 묶어 암묵적으로 지우지 않는다
- OPEN PR이 걸린 원격 브랜치는 선택지에서 제외하고 사유를 표시한다

## 3. Execute (§2에서 승인된 경고 대상만, 순서대로)

> §1.5에서 자동 삭제된 안전 대상은 여기서 다루지 않는다. 아래는 사용자가 §2 GATE에서 명시 승인한 항목만 실행한다.

### 3a. 테스트 DB (잔존 시)

`testDatabase.type`에 따라 `~/.claude/skills/orchestrate/references/test-db-isolation.md`의 Cleanup 명령을 **`testDatabase.name`에 대해서만** 실행한다 (`|| true`로 실패 무시).

> **템플릿 DB(`orch_tmpl_*`)는 삭제하지 않는다.** 마이그레이션 1회분 캐시라 지우면 다음 워크플로우가
> 전체 마이그레이션을 다시 돌린다. 사용자가 "템플릿까지 정리"를 **명시 요청**한 경우에만
> `psql -lqt | grep orch_tmpl_` 목록을 보여주고 승인받아 삭제한다.

### 3b. worktree 모드 대상 (`worktreeCreated == true`만)

> **채택 worktree(`worktreeCreated == false`)는 이 절을 건너뛴다** — worktree·로컬·원격 브랜치를 삭제하지 않는다(사용자 소유). plan·state 파일과 테스트 DB만 §3c·§3a로 정리한다.

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

> plan·state 파일은 worktree 안에 있으므로 worktree 제거와 함께 사라진다.

**원격 브랜치 (사용자가 명시적으로 선택한 경우만):**
```bash
git push origin --delete {branchName}
```

### 3c. main 모드 · 채택 worktree 대상 (파일만)

plan·state 파일을 삭제한다. 파일은 `workPath`의 `plans/`에 있다 — main 모드는 repo 루트, 채택 worktree는 그 worktree 루트. 채택 worktree는 §3b를 건너뛰었으므로 현재 cwd(자기 worktree)에서 그대로 실행한다.

```bash
rm -f {workPath}/plans/{identifier}.md {workPath}/plans/{identifier}.state.json
rmdir {workPath}/plans 2>/dev/null || true    # 디렉토리가 비었으면 함께 제거
```

## 4. Verify & Report (읽기)

> 검증은 자기 자신 대상(현재 worktree·브랜치)에 대해서만 수행한다. 삭제 실행 후 현재 worktree가 사라졌을 수 있으므로 `$MAIN_REPO`에서 확인한다.
>
> **채택 worktree(`worktreeCreated == false`)는 worktree·로컬·원격 브랜치가 의도적으로 남는다** — 아래 worktree/브랜치 제거 확인은 건너뛰고, plan·state 파일과 테스트 DB만 정리됐는지 확인한다.

```bash
cd "$MAIN_REPO"
git worktree list | grep {branchName}      # (생성 worktree만) 자기 worktree가 제거됐는지 (출력 없어야 정상)
git branch --list {branchName}             # 로컬 브랜치 제거 확인
git ls-remote --heads origin {branchName}  # 원격 브랜치 제거 확인 (삭제한 경우)
ls plans/ 2>/dev/null                      # main 모드였다면 파일 제거 확인
```

항목별 결과를 보고한다. **자동 삭제(§1.5 안전 대상)와 승인 삭제(§2 경고 대상)를 구분**해 — 각 항목이 어느 경로로 정리됐는지 함께 밝힌다:

| 항목 | 결과 |
|------|------|
| worktree | 삭제됨 / 실패 / 건너뜀 |
| 로컬 브랜치 | 삭제됨 / 실패 / 건너뜀 |
| 원격 브랜치 | 삭제됨 / 건너뜀(미선택·OPEN PR) |
| plan·state 파일 | 삭제됨 / 건너뜀 |
| 테스트 DB | 삭제됨 / 없음 |

실패한 항목은 에러 출력을 그대로 보여주고 수동 정리 명령을 안내한다.

## Done Criteria

- [ ] **현재 worktree(자기 자신)의 state 산출물만** 발견·평가됨 — 다른 worktree는 조사하지 않음
- [ ] 현재 worktree에 state가 없으면 다른 worktree를 뒤지지 않고 즉시 종료
- [ ] **채택 worktree(`worktreeCreated == false`)는 worktree·로컬·원격 브랜치를 제거하지 않음** — plan·state 파일과 테스트 DB만 정리
- [ ] 안전 대상(`worktreeCreated == true` + completed + 미커밋 없음 + 미push 없음 + PR MERGED)은 승인 없이 자동 삭제됨
- [ ] 경고(⚠️) 대상만 GATE로 사용자 명시 승인 후 삭제됨
- [ ] 자동 삭제분·승인 삭제분을 구분해 항목별 성공/실패 보고
