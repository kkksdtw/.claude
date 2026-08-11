---
description: Finalize development. Verification loop → code review → commit → ship (main: commit only / worktree: push + PR).
---

# Finalize and Ship

Prerequisite: `/orchestrate:impl`에서 구현 완료.

마무리 방식은 state의 `workspace`에 따라 갈린다:

| workspace | 마무리 |
|-----------|--------|
| `main` | commit까지만. **push·PR을 하지 않는다** — push는 사용자가 직접 |
| `worktree` | commit → push → PR 생성 |

## 0. State Guard

아래 절차를 순서대로 수행한다. 실패 시 즉시 중단하고 사용자에게 알린다.

1. **State 파일 탐색**: Glob으로 `plans/*.state.json` 검색
   - 파일 없음 → STOP: "`/orchestrate:start`를 먼저 실행하세요"
   - 파일 여러 개 → 목록을 보여주고 AskUserQuestion으로 선택 요청
2. **State 읽기**: Read 도구로 state.json을 읽고 JSON 파싱
3. **작업 디렉토리 전환**: `workPath` 디렉토리 존재 확인 후 Bash `cd {workPath}` 실행 → 없으면 STOP. 이후 모든 명령은 이 디렉토리에서 실행
4. **브랜치 확인** (worktree 모드만): `git branch --show-current`가 `branchName`과 일치하는지 확인 → 불일치 시 STOP. main 모드는 생략
5. **필드 추출**: workspace, **autonomy**, **speed**, projectType, techStack, commands, planFile, branchName, baseBranch 등 필요한 값 보관
6. **Phase 갱신**: state의 `currentPhase`를 `"done"`으로, `updatedAt`을 현재 시각으로 갱신 → Write로 저장

## 1. Verification Loop (최대 3회)

**검증 스킵 조건 (impl↔done 중복 제거):** phase 진입 시 state의 `implVerifiedClean === true` **이고** `verification.lint`/`build`/`test`가 모두 `"pass"`이면, impl phase에서 방금 전체 검증을 통과했고 이후 편집이 없다는 뜻이다 → **이 최초 검증 루프를 건너뛰고 곧바로 §2(Code Review)로 진행한다** (build를 통째로 두 번 도는 낭비 제거). 단 개별 `/orchestrate:done`으로 재개해 impl 이후 수동 편집 가능성이 있으면 스킵하지 말고 검증한다 — **애매하면 검증**한다. 스킵하지 않는 경우 아래 루프를 정상 수행한다.

> **fast 모드는 이 루프를 절대 스킵하지 않는다.** impl에서 검증을 건너뛰었으므로 `implVerifiedClean`이 false이고, 위 스킵 조건은 자연히 거짓이 된다. `speed === "fast"`인데 `implVerifiedClean`이 true로 보이면 **state가 잘못 기록된 것**이므로 그 값을 믿지 말고 검증을 실행한다. fast 워크플로우 전체에서 lint·build·test가 실행되는 지점은 **여기 한 곳뿐**이다 ([Speed Mode](../orchestrate.md#speed-mode---fast)).

state JSON의 `commands` 필드에 저장된 명령어를 순서대로 실행한다.

**테스트 DB 격리:** `rules/common/test-db-isolation.md` 프로토콜을 따른다.
state.json에 `testDatabase.name`이 있고 실제 DB가 존재하면 기존 DB를 재사용한다 (impl에서 만든 것).
없을 때만 프로토콜의 1~6단계를 수행한 후 테스트를 실행한다.

```
각 iteration:
  1. Lint:  commands.lint 값을 Bash로 실행
  2. Build: commands.build 값을 Bash로 실행 → 실패 시 수정 후 iteration 재시작
  3. Test:  프로토콜 §5의 서브셸 형태로 실행 → 실패 시 수정 후 iteration 재시작
  4. 모두 통과 → 루프 종료
```

> `.env`를 Read 도구로 읽지 않는다 — 셸이 로드하고 필요한 조각만 출력한다 (프로토콜 상단 원칙).

> state JSON에 commands 값이 없으면 AskUserQuestion으로 사용자에게 명령어를 직접 질문

**실패 시 처리** (state의 `attempts.doneVerify`로 추적 — 실패마다 +1 후 state Write, 최대 3회):

| attempts.doneVerify | 행동 |
|------|------|
| 1~2 | 에러 분석 → 직접 수정 → iteration 재시작 |
| 3 | Task 도구로 `build-error-resolver` 에이전트 실행 |
| 3 초과 | STOP: 사용자에게 에러 내용 보고 및 수동 해결 요청 |

전체 통과 시 `attempts.doneVerify`를 0으로 리셋한다. 카운터는 state에 영속 — 세션이 끊겨도 한도 유지.

## 2. Code Review (병렬)

1. **변경 파일 목록 획득** — untracked 신규 파일까지 포함해야 한다:
   ```bash
   git status --porcelain                              # 미커밋 변경 + untracked 신규 파일
   git diff --name-only {baseBranch}...HEAD            # worktree 모드: 이미 커밋된 변경이 있으면 합산
   ```
   두 출력을 합쳐 변경 파일 목록을 만든다. `plans/{identifier}.md`, `plans/{identifier}.state.json`은 제외한다.
2. **에이전트 프롬프트 작성 및 병렬 실행**: Task 도구로 `security-reviewer`와 `code-reviewer`를 동시에 실행

   > **모델**: `code-reviewer`는 `model: "sonnet"`으로 핀 고정한다. `security-reviewer`는 실제 코드의 취약점 캐치율을 위해 opus를 유지한다(핀하지 않음 — 메인 모델 상속).

**각 에이전트 프롬프트:**
```
당신은 {security-reviewer | code-reviewer} 전문가입니다.

## 컨텍스트
- 프로젝트 경로: {workPath}
- 기술 스택: {state JSON의 techStack 값}
- 변경된 파일 목록:
{step 1에서 만든 변경 파일 목록을 여기에 삽입}

## 작업
1. 위 파일들을 Read 도구로 읽으세요.
2. {security: 보안 취약점 | code: 코드 품질, 패턴 일관성} 관점에서 리뷰하세요.
3. 제공된 변경 파일 안에서 판단을 우선하세요. 기존 패턴과의 일관성 확인이 꼭 필요한 경우에만 직접 관련된 파일을 좁게 Grep/Glob 하세요 — 변경 파일 밖으로의 광역 탐색은 불필요한 왕복으로 리뷰 지연의 주원인이므로 최소화합니다.
4. **(code-reviewer만)** 사람 리뷰어를 위한 리뷰 동선을 도출하세요. 이미 위에서 파일을 전부 읽었으므로 **추가 탐색 없이** 판단합니다.
   - 판단 기준: **"이 줄이 잘못됐을 때 사람만 알아챌 수 있는가?"** → 그렇다면 `focus`, 아니면 `mechanical`.
   - `focus`: 설계 선택, 트랜잭션·동시성 경계, 에러 처리 분기, 기존 계약에 영향을 주는 지점. **최대 5개**, 중요도 순. 파일만이 아니라 줄 범위까지 짚습니다.
   - `mechanical`: 테스트, 보일러플레이트, 자동 생성물, 추가 전용 마이그레이션 등 판단이 거의 필요 없는 변경. 개별 나열 대신 패턴과 줄 수로 묶습니다.
   - `findings`와 독립입니다 — 결함이 하나도 없어도(`findings: []`) `focus`는 채웁니다. 리뷰할 곳이 없다는 뜻이 아니라 결함이 없다는 뜻이므로.

## 출력 형식
아래 JSON 하나만 출력하세요 (다른 텍스트 없이).

**security-reviewer:**
{
  "agent": "security-reviewer",
  "findings": [
    { "severity": "CRITICAL | HIGH | MEDIUM | LOW", "finding": "...", "recommendation": "...", "file": "..." }
  ]
}

**code-reviewer:**
{
  "agent": "code-reviewer",
  "findings": [
    { "severity": "CRITICAL | HIGH | MEDIUM | LOW", "finding": "...", "recommendation": "...", "file": "..." }
  ],
  "focus": [
    { "file": "src/notification/send.ts", "lines": "42-88", "why": "재시도 백오프 로직 — 이 PR의 핵심 판단" }
  ],
  "mechanical": [
    { "files": "*.spec.ts", "lines": 312, "note": "E2E 테스트" }
  ]
}
문제가 없으면 "findings": []
```

3. **결과 처리** (state의 `attempts.codeFix`로 추적 — **normal 최대 2회 / fast 최대 1회**):
   - CRITICAL/HIGH 발견 → `attempts.codeFix` +1 → **`implVerifiedClean=false`로 갱신** → state Write → 수정 후 step 1 verification loop 재실행 (수정으로 코드가 바뀌었으므로 스킵 조건이 거짓 → 반드시 전체 검증)
   - MEDIUM 이하만 → **자율 모드**: 발화하지 않고 자동 진행 (§6 완료 보고에 합산) · **게이트 모드**: 사용자에게 보고 후 진행 여부 확인
   - `attempts.codeFix`가 한도(normal 2 / fast 1)에 도달했는데 CRITICAL/HIGH 잔존 → 사용자에게 판단 요청 (자율 모드도 [에스컬레이션 조건](../orchestrate.md#autonomy-mode-게이트-자동-통과-vs-승인) 6번으로 멈춤. 카운터는 state에 영속 — 세션이 끊겨도 유지)

   > fast의 한도가 1인 것은 **수정 1회 후에도 CRITICAL이 남으면 자동 해소가 아니라 사람 판단이 필요한 상황**이라는 뜻이다. 리뷰 자체나 첫 수정 시도를 생략하는 것이 아니다 — fast에서도 리뷰는 두 에이전트 병렬로 그대로 돈다.

4. **리뷰 동선 보관**: code-reviewer의 `focus`/`mechanical`을 §4 PR 본문 작성에 사용하므로 보관한다. code-fix 루프가 돌아 리뷰를 재실행한 경우, 수정으로 줄 번호가 어긋났으므로 **가장 마지막 리뷰 결과의 값을 쓴다.** main 모드는 PR을 만들지 않으므로 사용하지 않는다.

## 2.5. UI 캡처 (UI/UX 변경일 때만)

화면이 바뀌었으면 **최종 화면을 캡처해 완료 보고에 첨부한다.** 코드 설명만으로는 UI 작업 결과를 확인할 수 없다.

**판정** — 아래 둘 다 만족할 때만 수행하고, 아니면 이 절 전체를 건너뛴다:
- state의 `projectType`이 `frontend` 또는 `fullstack`
- §2 step 1의 변경 파일에 화면 파일이 포함 (`.tsx`·`.jsx`·`.vue`·`.svelte`·`.astro`, 스타일시트, 템플릿)

**시점** — §1 검증과 §2 코드 리뷰 수정이 **모두 끝난 뒤.** code-fix 루프가 돌면 화면도 바뀌므로 마지막 상태를 찍는다.

1. **대상 화면** — 플랜의 요구사항과 변경 파일에서 해당 화면의 라우트를 도출한다. **최대 3장**, 핵심 화면 우선. 라우트를 특정할 수 없으면 진입 화면 1장.
2. **캡처** — `run` 스킬(Skill 도구, `skill: "run"`)로 앱을 띄우고 위 화면을 스크린샷한다. 저장 경로: `plans/shots/{identifier}-{화면}.png` — `plans/` 아래이므로 커밋 대상이 아니다.
3. **실패 처리** — dev 서버 기동 실패·라우트 접근 불가 등으로 캡처가 안 되면 **재시도 1회**, 그래도 안 되면 워크플로우를 막지 않고 넘어간다. **캡처 실패는 STOP 사유가 아니다** — 사유만 §6 완료 보고에 한 줄로 남긴다.
4. **발화 금지** — 자율 모드에서는 캡처 진행·중간 결과를 출력하지 않는다 ([발화 규율](../orchestrate.md#output-discipline-발화-규율)). 이미지는 §6 완료 보고에서 SendUserFile로 한 번에 첨부한다. 게이트 모드는 GATE 3 요약에 함께 보여줘도 된다.

> `--fast`에서도 생략하지 않는다. UI 변경에서 캡처는 검토 단계가 아니라 **결과 보고 자체**다.

## GATE 3: Ship (commit 전)

**`autonomy` 값에 따라 분기**한다 ([발화 규율](../orchestrate.md#output-discipline-발화-규율)).

- **자율 모드 (`auto`, worktree 전용 — 기본)**: ship 전 요약을 **출력하지 않고** 곧바로 commit → push → PR 생성까지 **끝까지 무인으로 실행한다.** 완료 보고는 §6 Output에서 1회. "PR을 만들까요?"·"진행할까요?"·"commit할까요?" 같은 확인을 **절대 묻지 않는다** — 자율 모드의 핵심은 ship(PR 생성)까지 무인 완료다. **유일한 예외:** 최종 diff에 [에스컬레이션 조건](../orchestrate.md#autonomy-mode-게이트-자동-통과-vs-승인)(운영/스테이징 데이터 손실·비가역 변경·보안 민감·호환성 파괴)에 해당하는 변경이 실제로 있을 때만 멈추고 AskUserQuestion으로 질문한다. 그 외에는 어떤 경우에도 멈추지 않고 PR까지 완료한다.
- **게이트 모드 (`gated`)**: 아래 요약을 정리해 출력하고 **STOP** — 사용자 승인을 받는다:
  - Verification 결과 (lint/build/test 각각 pass/fail)
  - Code review 결과 요약
  - 커밋 구성 — normal: 그룹별 파일 목록 + 커밋 메시지 (§3a에서 결정한 분할) / fast: 단일 커밋의 파일 목록 + 커밋 메시지
  - **main 모드**: "main 브랜치에 직접 커밋됩니다. push는 하지 않습니다" 명시 / **worktree 모드**: 생성될 PR의 제목과 타겟 브랜치({baseBranch})

통과(자동 또는 확인)하면 → state JSON을 Read → 아래 필드 갱신 → Write:
```jsonc
{
  "gates": { "finish": true },
  "updatedAt": "{현재 ISO 8601}"
}
```

## 3. Commit (논리 단위로 분할)

커밋을 논리 단위로 나눠 리뷰어가 **커밋별로** 읽을 수 있게 한다. PR은 1개지만 그 안에 읽는 순서를 만드는 것이 목적이다.

### 3a. 커밋 그룹 결정

> **fast 모드는 분할하지 않는다 — 단일 커밋으로 끝낸다.** 이 절(3a)을 건너뛰고 3b에서 변경 파일 전체를 한 번에 스테이징·커밋한다. 분할 판단 자체가 비용인 데다, fast가 대상으로 하는 작은 변경에서는 커밋을 나눠도 리뷰 동선이 거의 개선되지 않는다.
>
> 단, `plans/{identifier}.md`·`plans/{identifier}.state.json` **제외 규칙과 `git add -A` 금지는 fast에서도 유지한다** — 파일을 개별 지정해 스테이징한다.

**그룹 소스**: 같은 세션에서 impl phase가 이어졌으면 Workflow 반환값의 `phases[].results[].files`를 출발점으로 쓴다. `/orchestrate:done` 단독 재개로 그 값이 없으면 §2 step 1의 변경 파일 목록에서 직접 그룹핑한다.

**그룹 기준** — 레이어가 아니라 **읽는 순서**로 나눈다 (의존성 순):

| 순서 | 그룹 | 포함 |
|------|------|------|
| 1 | 스키마·마이그레이션 | 마이그레이션 파일, 엔티티·스키마 정의 (있을 때만) |
| 2 | 핵심 구현 | 도메인 로직 → 그것을 노출하는 계층 |
| 3 | 테스트 | E2E·유닛 테스트 |

**규칙:**
- 그룹이 1개로 수렴하면 **커밋 1개로 끝낸다.** 억지로 나누지 않는다.
- **최대 4개.** 그 이상은 리뷰 동선이 오히려 흐려진다.
- **커밋별 green을 보장하지 않는다** — 분할 목적은 bisect가 아니라 리뷰 동선이고, PR 최종 상태는 §1에서 이미 검증됐다.
- `plans/{identifier}.md`, `plans/{identifier}.state.json`은 어느 그룹에도 넣지 않는다.

### 3b. 그룹별 스테이징 → 커밋

```bash
# 1. 변경 파일 확인
git status

# 2. 그룹별로 스테이징 → 커밋 (git add -A 사용 금지 — 그룹 경계가 무너진다)
#    프로젝트의 .claude/rules/git-workflow.md 또는 CLAUDE.md의 commit convention을 따름
#    Claude/AI를 Co-Author·contributor로 넣지 않는다 — Co-Authored-By 트레일러를 추가하지 않는다.
git add {그룹 1 파일들 개별 지정}
git commit -m "$(cat <<'EOF'
{type}({scope}): {description}
EOF
)"

git add {그룹 2 파일들 개별 지정}
git commit -m "$(cat <<'EOF'
{type}({scope}): {description}
EOF
)"

# 3. 누락 확인 — plans/ 외에 미커밋 변경이 남아 있으면 안 된다 (그룹 분할 시 파일 누락 방지)
git status --porcelain
```

> commit format은 프로젝트의 `.claude/rules/git-workflow.md` 또는 CLAUDE.md의 convention을 따른다. 규칙이 없으면 `"type(scope): description"` 형식을 기본으로 사용.
> **Claude/AI 계정을 커밋 contributor로 포함하지 않는다** — `Co-Authored-By: Claude ...` 트레일러를 넣지 않는다. 프로젝트 convention이 co-author 트레일러를 요구하더라도 AI 계정은 제외하고 사람 기여자만 남긴다.

## 4. Ship

### main 모드

**push하지 않는다.** commit까지가 이 워크플로우의 끝이다.

state JSON을 Read → 아래 필드 갱신 → Write:
```jsonc
{
  "currentPhase": "completed",
  "updatedAt": "{현재 ISO 8601}"
}
```

### worktree 모드

```bash
# 1. Push
git push -u origin {branchName}

# 2. PR 생성 — rules/common/pull-request.md 템플릿을 따름
#    --assignee @me: 본인을 담당자로 지정해 GitHub 알림을 받는다.
#    (PR 작성자는 자신을 reviewer로 요청할 수 없으므로 reviewer 대신 assignee 사용)
gh pr create --base {baseBranch} --assignee @me --title "{type}({scope}): {description}" --body "$(cat <<'EOF'
## 개요
{이 PR이 해결하는 문제 또는 추가하는 기능}

## 주요 변경사항
- {논리적 단위로 정리된 변경사항}

## 리뷰 포인트
**집중해서 볼 곳:**
- `{focus[].file}:{focus[].lines}` — {focus[].why}

**기계적 변경 (빠르게 넘어가도 됨):**
- `{mechanical[].files}` ({mechanical[].lines}줄) — {mechanical[].note}

## 테스트
- [ ] E2E 테스트 추가/수정
- [ ] 로컬 테스트 완료
- [ ] 기존 테스트 통과

## 참고사항
{필요한 경우에만}
EOF
)"
```

> **리뷰 포인트**는 §2 step 4에서 보관한 code-reviewer의 `focus`/`mechanical`을 그대로 매핑한다 — 여기서 새로 판단하지 않는다 (이미 변경 파일을 전부 읽은 에이전트의 결과가 더 정확하다).
> 작성 규칙은 [pull-request.md](../../rules/common/pull-request.md#리뷰-포인트-작성-규칙). 변경이 작고(대략 50줄 미만) 어디를 볼지 자명하면 이 섹션을 생략한다.

PR 생성 후 → state JSON을 Read → 아래 필드 갱신 → Write:
```jsonc
{
  "pullRequest": {
    "url": "{gh 출력에서 추출한 PR URL}",
    "number": {PR 번호}
  },
  "currentPhase": "completed",
  "updatedAt": "{현재 ISO 8601}"
}
```

## 5. Test DB Cleanup

state.json의 `testDatabase` 필드가 존재하면 `rules/common/test-db-isolation.md`의 Cleanup 절차를 수행한다.

`testDatabase.type`에 따라 해당 drop 명령어를 실행한다:

| type | 명령어 |
|------|--------|
| postgresql | `dropdb "{testDatabase.name}" 2>/dev/null \|\| true` |
| mysql | `mysql -u root -e "DROP DATABASE IF EXISTS \`{testDatabase.name}\`;" 2>/dev/null \|\| true` |
| sqlite | `rm -f "{SQLite 파일 경로}" 2>/dev/null \|\| true` |
| mongodb | `mongosh --eval "db.getSiblingDB('{testDatabase.name}').dropDatabase()" 2>/dev/null \|\| true` |

실행 후 state.json의 `testDatabase`를 `null`로 갱신한다.

> cleanup 실패 시 에러를 무시하고 진행한다. Output에서 결과(성공/실패)를 보고한다.

## 6. Output

> **자율 모드에서는 이 Output이 워크플로우 전체의 유일한 완료 발화다** ([발화 규율](../orchestrate.md#output-discipline-발화-규율)). 중간에 생략했던 참고 정보를 여기에 압축해 한 번에 전달한다.

작업지시자에게 아래 결과를 보고한다:

1. **Verification**: lint/build/test 각 결과
2. **Ship 결과**:
   - main 모드: 커밋 해시 + "push는 직접 실행하세요: `git push origin {baseBranch}`"
   - worktree 모드: PR URL + 제목 + 브랜치명
3. **UI 캡처** (§2.5를 수행한 경우에만): SendUserFile로 스크린샷을 첨부하고, 각 장이 어떤 화면인지 한 줄씩 설명한다. 캡처에 실패했으면 사유를 한 줄로 보고한다
4. **Test DB Cleanup**: 삭제한 DB 이름 + 결과 (성공/실패)
5. **참고사항** (해당 시에만, 없으면 생략): fast 모드로 expert review를 건너뛴 사실, 미해결 MEDIUM/LOW findings, 자동 해소하지 못하고 그대로 둔 항목 등 — 중간에 발화하지 않고 미뤄둔 정보를 여기 한 줄로 모은다.
6. **Cleanup 안내** (실행은 하지 않음, 사용자가 직접 결정):
   - `/orchestrate:cleanup`으로 일괄 정리 — worktree, 로컬·원격 브랜치, plan·state 파일, 테스트 DB (미리보기 + 승인 후 삭제)
   - worktree 모드는 PR merge 후 정리 권장
   - **채택한 worktree(`worktreeCreated = false`)는 cleanup이 worktree·브랜치를 제거하지 않는다** — plan·state 파일과 테스트 DB만 정리한다

## Done Criteria

- [ ] Verification 전체 통과 (lint + build + test) — **fast는 이 phase에서 반드시 1회 실행됐어야 한다**
- [ ] Code review 완료, CRITICAL/HIGH 해소 (fast도 security + code 병렬 그대로)
- [ ] UI/UX 변경이면 최종 화면 캡처(최대 3장) 후 완료 보고에 첨부 — 실패 시 사유 한 줄 (STOP 아님)
- [ ] Gate 3 통과 — 자율 모드: 확인 없이 자동 ship / 게이트 모드: 사용자 확인 (commit 전)
- [ ] 커밋 완료 (plans/ 파일 제외) — normal: 논리 단위 분할, 그룹 1개면 단일, 최대 4개 / fast: 단일 커밋
- [ ] `git status --porcelain`에 plans/ 외 미커밋 변경이 남아 있지 않음
- [ ] 커밋 메시지에 Claude/AI co-author 트레일러 없음
- [ ] main 모드: push 미실행 + push 안내 출력 / worktree 모드: PR 생성(본인 `--assignee @me` 지정) + URL 보고
- [ ] worktree 모드: PR 본문에 리뷰 포인트 포함 — code-reviewer의 `focus`/`mechanical` 매핑 (소규모 자명한 변경이면 생략 가능)
- [ ] state JSON 갱신 — currentPhase = "completed" (worktree 모드: pullRequest 필드 포함)
- [ ] 테스트 DB 자동 삭제 완료, state의 testDatabase = null
