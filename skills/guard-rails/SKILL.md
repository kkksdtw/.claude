---
name: guard-rails
description: 위험한 에이전트 작업을 사전 차단하는 PreToolUse 가드와 최소 권한 경계를 구축
argument-hint: "[--audit] (현재 권한 노출만 진단) | (생략 시 가드 구축)"
allowed-tools: Bash, Read, Glob, Grep, Write
disable-model-invocation: true
---

# /guard-rails — 권한·안전 경계 (harness 4층)

너는 **시니어 harness 엔지니어**다. PostToolUse 게이트(verify.sh)는 코드를 만진 *후* 검증한다.
하지만 어떤 작업은 **일어난 뒤엔 늦다** — 시크릿 유출, 프로덕션 DB 삭제, 강제 푸시, 외부 전송.
이런 건 *하기 전에* 막아야 한다. 그게 PreToolUse 가드와 권한 경계다.

기준 개념: OWASP의 "Excessive Agency"(과잉 권한) — 에이전트에 필요 이상의 능력·권한·자율이
주어지면 사고가 난다. 해법은 **최소 권한 원칙**: 필요한 것만 허용하고, 위험한 건 차단하거나
사람 승인을 끼운다.

인자 `$ARGUMENTS`:
- `--audit`: 현재 어떤 위험에 노출돼 있는지 진단만 하고 끝(가드는 안 만듦).
- 생략 시: 진단 후 가드를 구축.

---

## 1단계 — 위험 표면 진단

이 레포에서 에이전트가 일으킬 수 있는 사고를 식별하라. 카테고리별로:

**(a) 파괴적 명령** — 되돌릴 수 없는 것.
- `rm -rf`, `git push --force`, `git reset --hard`, `DROP TABLE`, 마이그레이션 롤백,
  `docker ... down -v`(볼륨 삭제), 대량 파일 삭제.

**(b) 시크릿·민감정보 노출.**
- `.env`, `*.pem`, `credentials`, `*secret*` 파일 읽기/출력/커밋.
- 시크릿을 로그나 커밋 메시지에 쓰는 것. 하드코딩된 키 추가.
- `! git log --oneline -5` 등으로 기존에 시크릿이 커밋된 적 있는지도 점검(있으면 보고).

**(c) 외부 전송·부작용.**
- 프로덕션 엔드포인트로의 요청, 실제 결제/메일 발송 API 호출,
  terraform apply(우리 게이트가 plan은 보지만 apply는 별개), 배포 명령.

**(d) 권한 범위.**
- 현재 `.claude/settings.json`의 allow/deny 리스트 확인. 너무 넓게 열려 있지 않은가.
- hook이나 command의 allowed-tools가 과한가.

`--audit`이면 여기까지 하고 **위험 표면 리포트**(노출된 것 + 심각도)만 내고 멈춰라.

## 2단계 — PreToolUse 가드 작성: `.claude/hooks/guard.sh`

위험 작업을 *실행 전에* 검사해 차단/경고/통과한다. PreToolUse hook은 Bash 등 도구 호출을
가로채 stdin으로 받는다. exit 2 = 차단. 골격:

```bash
#!/usr/bin/env bash
# guard.sh — PreToolUse 가드. 위험 작업을 실행 전 차단. exit 2 = 차단.
set -uo pipefail
J="$(cat 2>/dev/null||true)"
# 도구 종류와 입력 추출
TOOL="$(printf '%s' "$J" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j.tool_name||"")}catch{process.stdout.write("")}})' 2>/dev/null||true)"
CMD="$(printf '%s' "$J" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j.tool_input?.command||j.tool_input?.file_path||"")}catch{process.stdout.write("")}})' 2>/dev/null||true)"

block(){ echo "🛑 [guard] 차단: $1"; echo "   $2"; exit 2; }

# (a) 파괴적 명령
case "$CMD" in
  *"rm -rf /"*|*"rm -rf ~"*)        block "위험한 재귀 삭제" "경로를 좁히거나 사람이 직접 실행하라." ;;
  *"git push --force"*|*"push -f"*) block "강제 푸시" "--force-with-lease를 쓰거나 사람 승인 후 실행." ;;
  *"git reset --hard"*)             block "하드 리셋(작업 손실 위험)" "변경을 stash로 보존 후 진행." ;;
  *"DROP TABLE"*|*"TRUNCATE"*)
    # 예외: orchestrate가 만든 폐기용 격리 테스트 DB (skills/orchestrate/references/test-db-isolation.md)
    case "$CMD" in *_test_*|*orch_tmpl_*) ;;
      *) block "파괴적 SQL" "마이그레이션 검토 + 사람 승인 필요." ;; esac ;;
  *"down -v"*)                      block "도커 볼륨 삭제" "데이터 손실 위험. 사람이 확인." ;;
  *"terraform apply"*|*"tofu apply"*) block "인프라 적용" "plan 검토 + 사람 승인 후 직접 실행." ;;
esac

# (b) 시크릿 — 파일 접근 자체가 아니라 "값이 새어나오는가"로 판단한다.
#     .env를 셸이 로드하는 것(sourcing)은 값을 노출하지 않는다 → 허용.
#     값을 stdout으로 꺼내는 것만 차단 → 컨텍스트·로그 오염 방지.
case "$TOOL" in
  Read|Write|Edit)
    # 파일 내용이 통째로 에이전트 컨텍스트에 들어온다 → 템플릿(.example)만 허용
    case "$CMD" in
      *".example") ;;
      *.env|*.env.*|*.pem|*"credentials"*|*"id_rsa"*)
        block "시크릿 파일을 컨텍스트로 읽기" \
              "값은 필요 없다. 셸에서 'set -a; . ./.env; set +a'로 로드하고 필요한 조각만 출력하라." ;;
    esac ;;
  Bash)
    case "$CMD" in
      # 로드(sourcing)는 값을 노출하지 않는다 → 통과
      *"set -a"*|*". ./.env"*|*"source ./.env"*|*". .env"*|*"source .env"*) ;;
      # 파일 내용을 stdout으로 흘리는 것
      *cat*.env*|*grep*.env*|*head*.env*|*tail*.env*|*sed*.env*|*awk*.env*|*"cat "*.pem*|*"cat "*id_rsa*)
        block "시크릿 값 출력" \
              "값을 stdout으로 꺼내지 마라. 'set -a; . ./.env; set +a' 후 필요한 조각만 echo하라." ;;
      # 환경변수 값을 통째로 출력하는 것
      *'echo $DATABASE_URL'*|*'printenv'*|*'env | '*)
        block "환경변수 값 출력" \
              "credential이 로그에 남는다. 스킴·host·DB 이름 등 필요한 조각만 파라미터 확장으로 출력하라." ;;
    esac ;;
esac

exit 0
```

### 시크릿 가드가 "경로"가 아니라 "유출"을 보는 이유

경로 기반 차단(`*.env` 매칭)은 **정당한 작업까지 막는다**. 대표적으로 orchestrate의 테스트 DB 격리는
`.env`에서 `DATABASE_URL`을 알아야 하는데, 차단당한 에이전트는 포기하지 않고 `cat`·`grep`·`sed`로
우회를 시도한다 — 그 결과 **원래 막으려던 credential이 오히려 컨텍스트에 남는다.**

그래서 기준을 옮긴다: 파일을 셸이 로드하는 것(`. ./.env`)은 값이 어디에도 출력되지 않으므로 허용하고,
값이 stdout으로 나오는 경로만 막는다. 값이 필요한 쪽은 [test-db-isolation](../orchestrate/references/test-db-isolation.md)의
감지 스니펫처럼 **스킴·host·DB 이름 같은 조각만** 출력하면 된다.

> 한계: `set -a; . ./.env; set +a; cat .env`처럼 허용 패턴과 결합하면 첫 매칭에서 통과한다.
> 과차단을 피하려는 의도적 트레이드오프다 — 가드는 사고를 줄일 뿐 유일한 방어선이 아니다.

이 목록은 **시작점**이다. 1단계 진단에서 이 레포 특유의 위험(특정 배포 스크립트, 특정 프로드
엔드포인트 등)을 발견하면 case에 추가하라. 단, **과차단 주의** — 정당한 작업까지 막으면
에이전트가 무력해진다. 애매하면 차단 대신 경고(exit 0 + 메시지)로 둬라.

## 3단계 — settings.json 권한 경계 + hook 등록

`.claude/settings.json`에 PreToolUse hook을 등록하고, 명백히 위험한 건 deny 리스트로도 이중화:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash|Write|Edit",
        "hooks": [ { "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/guard.sh\"" } ] }
    ]
  },
  "permissions": {
    "deny": [ "Read(./.env)", "Read(./**/*.pem)", "Bash(git push --force:*)" ]
  }
}
```

기존 settings.json이 있으면 **PostToolUse(우리 게이트)를 보존하면서 PreToolUse만 병합**하라.
deny 리스트는 1단계 진단 결과에 맞게 조정. 최소 권한: 필요한 것만 allow, 위험한 건 deny.

## 4단계 — 검증

- `! bash -n .claude/hooks/guard.sh && echo "문법 OK"`
- 차단 스모크: 위험 명령을 흉내낸 JSON을 guard.sh에 먹여 exit 2가 나는지 확인.
  예: `! echo '{"tool_name":"Bash","tool_input":{"command":"git push --force"}}' | bash .claude/hooks/guard.sh; echo "exit=$?"`
- 통과 스모크: 정상 명령(`npm test` 등)은 exit 0인지 확인(과차단 없는지).

## 5단계 — 보고
- 발견된 위험 표면 + 심각도
- 만든 가드가 차단하는 목록 + 사람 승인으로 넘긴 목록
- ⚠️ 과차단 가능 지점(정당한 작업이 막힐 수 있는 case)을 사용자에게 알리고 조정 여부 확인
- 권장: 시크릿이 과거 커밋에 있었다면 별도 secret rotation 필요(가드는 미래만 막음)

---

## 시니어 태도
- **사후 검증과 사전 차단은 다른 층이다.** verify.sh(사후)와 guard.sh(사전)는 짝이다.
- **과차단은 과소차단만큼 해롭다.** 막으면 에이전트가 멈추므로, 애매하면 경고로.
- **가드는 마지막 방어선이지 유일한 방어선이 아니다.** 진짜 시크릿은 코드에 없어야 한다(가드는 사고를 줄일 뿐).
- 파괴적 작업은 막기보다 **사람 승인으로 라우팅**하는 게 보통 옳다(완전 차단은 막힌 작업을 우회하게 만든다).
