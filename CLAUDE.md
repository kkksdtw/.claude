# CLAUDE.md

## 답변 언어 (MOST IMPORTANT)

**IMPORTANT: 사용자에게 보이는 모든 답변은 반드시 한국어로 작성한다.** 영어로 답변하지 않는다.

- 예외(원문 유지): 코드·식별자·명령어·파일 경로·로그/에러 메시지 원문·고유명사·기술 용어.
- 위 예외를 제외한 설명·요약·질문·제안은 전부 한국어로 쓴다.
- 이 규칙은 다른 모든 지침보다 우선한다.

## When writing the code (IMPORTANT) 

- **소스 코드에 주석을 쓰지 않는다** — 한 줄·블록·docstring·JSDoc·TODO·`ponytail:` 주석 모두 금지. 의도는 이름·구조·테스트로 드러낸다. 기존 주석은 건드리지 않는다. 예외는 도구가 해석하는 지시문(`eslint-disable`, `@ts-expect-error`, `# noqa`, shebang 등)뿐이다. ponytail의 `ponytail:` 주석 규칙보다 우선하며, 단순화의 한계는 주석 대신 최종 보고에 한 줄로 남긴다. PreToolUse 훅 [scripts/hooks/no-comments.js](scripts/hooks/no-comments.js)가 강제한다.
- Do not use abstract words for all function names, variable names. (e.g. Info, Data, Item etc..)
- Follow naming conventions: [rules/common/naming-conventions.md](rules/common/naming-conventions.md) — prefer the shortest unambiguous name (e.g. `getList` → `list`, `findUserById` → `find`).
- 커밋 메시지는 기존 컨벤션을 분석한 뒤 한글로 작성한다: [rules/common/git-commit.md](rules/common/git-commit.md)
- Use the **naming** skill ([skills/naming/SKILL.md](skills/naming/SKILL.md)) when proposing or reviewing identifier names; run `/naming` to audit existing code.

## DevOps / Infra (AWS · Terraform · EKS · GitHub Actions)

환경: AWS 자원이 **콘솔(legacy) ↔ Terraform**로 분리됨 · 서비스는 **EKS + GitOps(ArgoCD/Flux)** · CI/CD는 **GitHub Actions** · **비용은 MSP 대시보드 별도(harness 범위 밖)**.

- **실행 안전(필독)**: 읽기는 자동, 변경(apply/delete/sync/rerun)은 승인 — [rules/devops/safety.md](rules/devops/safety.md). 대상 account/region/context를 항상 먼저 확인.
- 지식 skill(자동 활성화): **terraform** · **eks** · **github-actions** · **aws** — [skills/](skills/)
- 절차 skill: `/eks-debug` · `/ci-debug` · `/tf-drift` · `/aws-inventory`(읽기 전용, 자동 활성화) · `/tf-import`(state 변경, 명시 호출 전용)
- agent: **terraform-reviewer** · **eks-doctor** · **cicd-reviewer** · **aws-auditor** — 대응 지식 skill을 프리로드

## Browser

- 브라우저 작업은 **obscura**(`mcp__obscura__browser_*`)만 쓴다. 단순 페이지 읽기는 `obscura fetch <url> --dump markdown`.
- 읽기·탐색은 자동, 입력·클릭·JS 실행·쿠키/스토리지는 승인 — [settings.json](settings.json) `permissions`가 강제한다. Chrome 확장·내장 브라우저는 deny.
- 실제 렌더링 검증(레이아웃·반응형·대비·스크린샷)은 **ux-reviewer** agent에 URL과 함께 위임한다. Chrome(`chrome-devtools`)은 이 agent에만 연결된다.
- 그 밖에 obscura로 안 되면(로그인 세션 필요 등) 다른 브라우저로 넘어가지 말고 멈추고 보고한다. `--stealth`는 사용자가 명시할 때만 켠다.

# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
# graphify
- **graphify** (`~/.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.
