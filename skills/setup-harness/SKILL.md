---
name: setup-harness
description: 레포 생태계를 감지하고, 실측+웹리서치로 도구를 판단해 토폴로지에 맞는 .claude harness를 구축
argument-hint: "[--dry-run] (감지·계획만) | [--no-web] (웹리서치 생략, 실측만)"
allowed-tools: Bash, Read, Write, Edit, WebSearch, WebFetch, Glob, Grep
disable-model-invocation: true
---

# /setup-harness — 토폴로지 적응형 harness 빌더

너는 **시니어 harness 엔지니어**다. 아직 harness가 없는 레포에 들어와,
생태계를 감지하고, 그 레포에 *실제로* 맞는 코드 품질 게이트를 구축한다.

이건 고정 템플릿을 복사하는 작업이 **아니다.** 레포마다 언어·도구·토폴로지가 다르므로,
너는 매번 감지하고 판단해서 그 레포에 맞는 `.claude/`를 생성한다.
레포 종류를 미리 가정하지 마라 — 감지가 먼저고, 실측이 리서치보다 우선이다.

인자(`$ARGUMENTS`):
- `--dry-run`: 4단계까지 수행(감지·도구판단·계획)하고 파일은 쓰지 않는다.
- `--no-web`: 웹리서치를 건너뛰고 레포 실측만으로 판단한다(오프라인/속도 우선).

---

## 불변 원칙 (생성하는 모든 게이트가 반드시 지킬 것)

이 다섯 가지는 레포·생태계와 무관하게 절대 어기지 마라. 위반하면 게이트가 신뢰를 *파괴*한다.

1. **감지된 생태계에만** 게이트를 만든다. 없는 생태계 게이트를 만들지 마라.
2. **실행 가능한 도구에만** 센서를 활성화한다. 도구가 없으면 게이트는 깔되 센서는
   비활성+경고로 둔다. (없는 도구로 막으면 거짓 빨강 / 생태계를 놓치면 거짓 초록 — 둘 다 해롭다.)
3. **모든 센서는 비변형이다.** `fmt --write`, `biome --write`, `ruff --fix`, `gofmt -w`,
   `eslint --fix` 같이 코드를 *바꾸는* 명령을 게이트에 절대 쓰지 마라. 검사 전용 플래그만 쓴다
   (`fmt -check`, `biome check`, `ruff check`, `gofmt -l`, `tsc --noEmit`). 변형 명령은
   사람이 수동으로 돌리도록 `*:fix` 류 별도 스크립트로 분리하라.
4. **차단은 `exit 2`로** 한다. 차단 시 출력에 "무엇이 왜 틀렸고 어떻게 고치는지" 교정 지시를
   포함하라(단순 에러 덤프 금지 — 에이전트가 그걸 읽고 자기교정한다).
5. **실측 > 리서치.** 웹리서치가 "X가 표준"이라 해도, 레포가 Y를 쓰고 있으면 Y에 맞춘다.
   리서치는 "이 레포가 쓰는 도구를 게이트에 *어떻게* 거는 게 옳은가"를 보강할 때만 쓴다.

---

## 1단계 — 생태계 감지

레포를 스캔해 어떤 생태계가 있는지 식별하라. 마커 파일 기준:

- `! git rev-parse --show-toplevel` — 루트 확정
- Node/TS: `package.json` (+ `pnpm-workspace.yaml`/`workspaces` → 모노레포)
- Terraform/OpenTofu: `*.tf` / `*.tofu`
- Go: `go.mod`
- Python: `pyproject.toml` / `setup.py` / `requirements.txt`
- Rust: `Cargo.toml`, Java/Kotlin: `pom.xml`/`build.gradle`, 그 외 마커도 발견하면 포함

`node_modules`, `.terraform`, `.git`, `dist`, `.next` 등은 스캔에서 제외하라.
glob/grep으로 레포 전체를 훑되, 모노레포면 어느 하위 경로에 어느 생태계가 몰려 있는지도 기록하라
(예: `infra/` 아래 .tf, `apps/` 아래 NestJS).

산출: **감지된 생태계 목록 + 각 생태계의 위치(경로)**.

---

## 2단계 — 도구 판단 (실측 우선 → 리서치 보강)

감지된 생태계마다, 그 레포가 *실제로 쓰는* 검증 도구를 먼저 확정하라. 이 순서로:

**(a) 레포 실측 — 항상 먼저.**
- 설정 파일을 직접 읽어라: `package.json`의 scripts/devDependencies, `biome.json`,
  `.eslintrc*`, `tsconfig.json`, `.tflint.hcl`, `pyproject.toml`의 `[tool.*]`,
  `.pre-commit-config.yaml`, CI 워크플로(`.github/workflows/*`) 등.
- 도구가 실제 실행 가능한지 확인: `! command -v <tool>` 또는 `node_modules/.bin/<tool>`.
- ⚠️ 이전 진단에서 배운 함정: 사용자가 "eslint/npm"이라 말해도 레포는 "Biome/pnpm"일 수 있다.
  말이 아니라 **파일과 lockfile이 진실**이다. 패키지매니저는 lockfile로 판정하라.

**(b) 웹리서치 — `--no-web`가 아니면 보강용으로.**
실측으로 도구를 확정한 뒤, 그 도구를 *게이트에 거는 올바른 방법*이 불확실하면 검색하라.
검색 대상은 도구 이름이 아니라 **"hook/CI에서 비변형으로 거는 현재 권장 명령과 함정"**이다. 예:
- "<도구> CI check non-mutating exit code 2026"
- "<도구> pre-commit hook recommended flags"
- 특히 버전 따라 플래그가 바뀌는 도구(terraform validate의 init 선행 등)는 반드시 확인.
검색 결과로 명령 플래그를 정할 땐, 위 불변원칙 3(비변형)에 맞는 플래그만 채택하라.

**(c) 누락 판단.**
생태계는 있는데 검증 계층이 비어 있으면 기록하라(5단계 권고로 이어진다). 예:
- 린터가 아예 없음 / 타입체커 미설정 / 테스트가 가짜 초록불(컴파일 산출물을 테스트) /
  Terraform에 fmt만 있고 tflint·보안스캔 없음 / .env.test 부재로 e2e 부팅 불가 등.

산출: **생태계별 {확정된 도구, 게이트에 걸 비변형 명령, 누락·약점 목록}**.

---

## 3단계 — 공통 인프라 + 생태계 게이트 스크립트 작성

토폴로지에 맞는 `.claude/`를 생성한다. 골격은 **디스패처 + 생태계별 게이트 모듈** 패턴으로 고정하라
(매번 구조가 달라지면 팀이 못 읽는다). 안을 채우는 도구·명령만 2단계 판단을 반영한다.

### 3-1. `.claude/hooks/verify.sh` — 얇은 디스패처 (모든 레포 공통 골격)

수정된 파일의 확장자로 생태계를 판정해 `gates/<eco>.sh`로 위임한다. 정확히 이 구조를 따르되,
`case` 분기의 확장자→생태계 매핑은 **감지된 생태계만** 포함하라:

```bash
#!/usr/bin/env bash
set -uo pipefail
CHANGED_FILE="${1:-}"
if [ -z "$CHANGED_FILE" ]; then
  J="$(cat 2>/dev/null||true)"
  [ -n "$J" ] && CHANGED_FILE="$(printf '%s' "$J" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j.tool_input?.file_path||j.tool_input?.path||"")}catch{process.stdout.write("")}})' 2>/dev/null||true)"
fi
[ -z "$CHANGED_FILE" ] && { echo "ℹ️ verify.sh: 경로 없음, 건너뜀."; exit 0; }
GATES="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/gates"
ECO=""
case "$CHANGED_FILE" in
  # ← 감지된 생태계의 확장자 매핑만 여기 채운다
  *.ts|*.tsx|*.mts|*.cts|*.js|*.jsx) ECO="node" ;;
  *.tf|*.tofu|*.tfvars) ECO="terraform" ;;
  *.go) ECO="go" ;;
  *.py) ECO="python" ;;
  *) echo "ℹ️ verify.sh: 게이트 대상 아님, 건너뜀."; exit 0 ;;
esac
GATE="$GATES/$ECO.sh"
[ ! -f "$GATE" ] && { echo "⚠️ '$ECO' 게이트 없음. /setup-harness 재실행 필요."; exit 0; }
bash "$GATE" "$CHANGED_FILE"; exit $?
```

### 3-2. `.claude/hooks/gates/<eco>.sh` — 생태계별 게이트 (감지된 것만 생성)

각 게이트는 2단계에서 확정한 **비변형 명령들을 신뢰순으로** 건다. 공통 형식:
- 헤더로 `🔎 [<eco>] <대상>` 출력
- 센서를 빠르고 신뢰도 높은 순서로(보통: 포맷검사 → 타입/문법 → 린트 → 테스트)
- 각 센서: 도구 있으면 실행, 없으면 `⚪ 비활성` 출력하고 **막지 않음**
- 위반 누적 후, 있으면 교정 지시와 함께 `exit 2`, 없으면 `exit 0`

생태계별 신뢰순 가이드(2단계 실측으로 명령을 확정하되 순서는 이걸 따르라):
- **node**: `tsc --noEmit`(또는 `tsc -b`) → `biome check`/`eslint`(실측 도구) → 테스트.
  모노레포면 `scripts/harness-classify.mjs`로 패키지별 토폴로지를 판정해 강도를 조절하라
  (아래 3-3). 단일 패키지면 분류기 없이 단순 게이트로 충분.
- **terraform**: `fmt -check -recursive`(항상 안전·1급) → `validate`(**`.terraform/`가 있는,
  즉 init된 디렉터리에서만** 조건부; hook에서 강제 `init` 금지 — 백엔드 접근 부작용) →
  `tflint`(설치 시) → 보안스캐너(trivy/checkov, 설치 시).
- **go**: `gofmt -l`(비변형) → `go vet` → (선택)`go build`. `go test`는 느리면 분리.
- **python**: `ruff check`(있으면) → `mypy`(있으면) → (선택)`pytest`.
- 그 외 생태계: 같은 원칙으로 "비변형 포맷검사 → 정적분석 → 테스트" 신뢰순 구성.

### 3-3. node 모노레포면 `scripts/harness-classify.mjs` 추가

모노레포는 패키지마다 상태가 다르다(어떤 건 타입 깨끗, 어떤 건 기존 빚, 어떤 건 가짜 초록불).
한 게이트로 일괄 적용하면 거짓 신호가 난다. 분류기를 만들어 **수정된 파일의 패키지를 런타임 판정**하고
게이트가 그에 맞게 강도를 조절하게 하라. 분류기가 판정할 것(이전 진단에서 검증된 신호들):
- **토폴로지**: 풀스택 API(별도 */core,*/db 의존 + e2e) / standalone serverless(db패키지 없이
  ORM 직결 → 기존 타입 빚 가능) / 공유 패키지(@packages/* fan-in 허브).
- **tsc 기준선**: 기존 에러가 있는 패키지는 "악화만 차단"하도록 `.harness-tsc-baseline`(에러 수)을
  읽어 비교. 남이 만든 빚으로 막지 않는다.
- **가짜 초록불**: jest에 ts 트랜스폼 설정이 없으면 컴파일된 dist의 .spec.js가 도는 거짓 통과.
  이 경우 테스트 게이트를 건너뛰고 경고("초록불≠안전").
- **e2e 환경**: `.env.test` 부재 시 e2e를 경고하며 건너뜀(차단 안 함).

### 3-4. 루트 `package.json` 스크립트 병합 (node 감지 시)

비변형 표준 명령을 신설/병합하라(기존 보존, 동명 충돌은 사용자에게 확인):
- `typecheck`, 비변형 `check`(실측 린터 기준), 그리고 변형은 `*:fix`로 분리.
- ⚠️ 기존 `lint`가 변형 명령(`biome format --write` 등)이면 그대로 두되 **게이트엔 쓰지 말고**
  비변형 `check`를 별도 신설하라.

---

## 4단계 — Hook 등록 + AGENTS.md

### 4-1. `.claude/settings.json` (있으면 `hooks.PostToolUse`만 병합, 다른 설정 보존)

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "hooks": {
    "PostToolUse": [
      { "matcher": "Edit|Write|MultiEdit",
        "hooks": [ { "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/verify.sh\"" } ] }
    ]
  }
}
```

### 4-2. `AGENTS.md` (루트, 목차 — 감지 결과에 맞춰 작성)

100줄 안팎 목차로. 감지된 생태계 섹션만 포함하고, 백과사전이 되지 마라. 반드시 담을 것:
- **도구 진실**: 이 레포가 실제 쓰는 패키지매니저·린터(실측 기준. 흔한 오해 명시: 예 "pnpm/Biome다, npm/ESLint 아님")
- **작업 후 자동 검증**: verify.sh가 확장자로 게이트를 돌린다. 비변형 원칙, exit 2 시 교정 지시 따르기.
- **신뢰 규칙**: "초록불 ≠ 안전"(비활성 센서/가짜 초록불). 발견된 함정은 docs/known-traps.md로.
- **생태계별 센서 순서** 한 줄 요약.
- **어디를 볼까**: docs/ 안내.

발견된 함정(2단계 누락/약점, 3-3 가짜 초록불 등)이 있으면 `docs/known-traps.md`도 생성하라.

---

## 5단계 — 검증 + 보완 권고

### 5-1. 생성물 자가검증 (반드시 실행)
- `! chmod +x .claude/hooks/verify.sh .claude/hooks/gates/*.sh scripts/*.mjs 2>/dev/null`
- `! for f in .claude/hooks/verify.sh .claude/hooks/gates/*.sh; do bash -n "$f" && echo "문법 OK $f"; done`
- node 분류기 만들었으면: `! node --check scripts/harness-classify.mjs && node --check scripts/harness-detect.mjs 2>/dev/null`
- **라우팅 스모크**: 감지된 각 생태계의 실제 파일 하나로 `! bash .claude/hooks/verify.sh <경로>`
  실행해 올바른 게이트로 위임되는지 확인.
- node 모노레포의 기존 빚 패키지는 tsc 기준선 1회 생성 후 **git 커밋**(`.gitignore` 금지).

### 5-2. 보완 권고 (사용자에게 명확히 보고)
2단계에서 모은 누락·약점을 우선순위와 함께 권고하라. 형식 예:
- 🔴 **즉시**: "<eco>에 린터/타입체커가 없다. 게이트의 정적분석 센서가 비어 있으니
  <권장도구>를 설치하면 즉시 활성화된다." / "가짜 초록불 발견(<패키지>): jest ts 트랜스폼 추가 필요."
- 🟡 **곧**: "Terraform fmt만 있고 tflint 없음 → `tflint` 설치 시 린트 센서 활성." /
  ".env.test 부재로 <앱> e2e 부팅 불가 → .env.test.example 커밋 권장."
- ⚪ **선택**: 보안 스캐너(trivy/checkov), 커버리지 게이트 등.
각 권고에 "설치/조치하면 어떤 센서가 켜지는지"를 반드시 붙여라(행동 가능하게).

### 5-3. 마무리 보고
- 감지된 생태계 + 각 위치 + usable 여부
- 생성된 파일 트리(`.claude/` 구조)
- 비활성 센서와 활성화 조건(5-2 권고)
- 다음 단계: 각 생태계에서 일부러 위반을 넣어 게이트가 `exit 2`로 막는지 한 번씩 확인 권장

---

## 작업 태도 (시니어로서)

- **막히면 멈추고 보고하라.** 도구 판단이 모호하거나 기존 설정과 충돌하면, 임의로 정하지 말고
  발견 사실과 선택지를 사용자에게 제시하라.
- **추측으로 도구를 깔지 마라.** "아마 ESLint 쓰겠지"로 게이트를 만들지 말고, 실측으로 확인된 것만.
- **과설계 금지.** 레포가 단순하면 게이트도 단순하게. 모노레포 분류기는 모노레포일 때만.
- **모든 생성물은 비변형·exit 2 규약을 지키는지 스스로 점검**한 뒤 사용자에게 넘겨라.
