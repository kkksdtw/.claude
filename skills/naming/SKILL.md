---
name: naming
description: "코드 식별자(변수·함수·메서드·class·모듈·repository·객체 키)의 이름을 제안·검토하거나, 기존 코드가 작명 규칙을 지키는지 감사한다. 새 식별자의 이름을 정할 때, 이름을 리팩토링할 때, PR의 이름 일관성을 볼 때 사용한다. 트리거 — \"이름 뭐가 좋을까\", \"이 이름 괜찮아?\", \"작명 검토\", \"네이밍 검사\", \"/naming\"."
argument-hint: "[<path> | --all] (생략 시 git 변경 파일 감사) 또는 작명할 대상 설명"
---

# Naming

기준은 `~/.claude/rules/common/naming-conventions.md` 하나다. 컨텍스트에 로드되어 있지 않으면 먼저 Read한다. 이 스킬은 규칙을 다시 적지 않고 **적용 절차**만 정의한다.

인자: `$ARGUMENTS`

| 입력 | 모드 |
|------|------|
| 작명할 대상·검토할 이름을 말로 설명 | **제안/검토** |
| 인자 없음 | **감사** — `git diff --name-only HEAD` + `git diff --name-only --staged`의 소스파일 |
| `<path>` | **감사** — 해당 경로의 소스파일 |
| `--all` | **감사** — 프로젝트 소스 디렉토리(`src/`, `lib/`, `app/` 등) 전체 |

## 제안/검토 모드

요청된 식별자만 다룬다. 규칙 위반이 없으면 그대로 둔다 — "더 좋은 이름"을 이유 없이 제안하지 않는다.

1. **상위 컨텍스트 파악** — class·모듈·파일·객체 이름이 이미 무엇을 표현하는지 확인한다.
2. **후보 도출** — 가장 짧은 한 단어(`list`, `find`, `create`)에서 시작하고, 의미가 통하지 않을 때만 단어를 더한다.
3. **중복 제거** — 상위 식별자 반복, 자명한 동사 접두어(`get`·`fetch`·`retrieve`), 추상 접미사(`Data`·`Info`·`Item`·`Object`·`List`), 금지 단어(`Manager`·`Handler`·`Helper`·`Util`)를 뺀다.
4. **모호함 검증** — 같은 class/모듈의 다른 식별자와 구분되는가, 호출부만 보고 의도가 읽히는가, 도메인 용어를 잃지 않았는가(`paymentIntent` → `intent`는 손실). 모호하면 단어를 다시 더한다.
5. **호출부 시뮬레이션** — `user.userId`처럼 중복되면 잘못된 이름이다.

근거는 항상 naming-conventions.md의 어느 절인지 명시한다.

새 이름 제안:

```
컨텍스트: {class/모듈/파일 이름}
대상: {function, key, variable 등}

후보:
1. {이름} — {선택 이유 1줄}
2. {이름} — {대안과 trade-off}

추천: {1순위}
근거: naming-conventions.md의 {규칙}
호출부 예시: {예: user.find(id)}
```

기존 이름 검토:

```
파일: {경로}:{라인}
현재: {기존 이름}
문제: {컨텍스트 중복 / 자명한 접두어 / 추상 단어 등}
제안: {새 이름}
호출부 영향: {호출부가 어떻게 바뀌는지}
```

## 감사 모드

대상 확장자: `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.kt`, `.java` (프로젝트에 맞게 판단).

### 1. 후보 검출

| 심각도 | 항목 | 검출 |
|--------|------|------|
| HIGH | class 메서드가 class 이름 반복 (`UserService.getUserById`) | `class (\w+)\s*{[^}]*\b(get\|find\|update\|delete\|create)\1\w*\(` |
| HIGH | `*Repository`·`*Repo` 메서드가 도메인 이름 반복 (`UserRepository.findUserById`) | 위와 동일 |
| HIGH | 객체 키가 객체/변수 이름을 접두어로 반복 (`user = { userId }`) | `const (\w+)\s*=\s*{` 매칭 후 키가 `\1`로 시작하는지 |
| HIGH | 모듈 함수가 파일/모듈 이름 반복 (`payment.ts`의 `createPayment`) | 파일명이 export 함수명에 포함되는지 |
| MEDIUM | 자명한 동사 접두어 (`getList`, `fetchAll`) | `\b(get\|fetch\|retrieve)(List\|All\|Data)\b` |
| MEDIUM | 추상 접미사 (`userDataList`) | `\b\w+(Data\|Info\|Item\|Object\|List\|Array)\b` |
| LOW | 금지 단어 | `Manager`, `Handler`, `Helper`, `Util`, `Utils` |

### 2. 컨텍스트 검증

패턴에 걸린 후보는 **반드시 실제 코드를 Read해** false-positive를 걸러낸다.

- 호출부에서 중복이 실제로 일어나는가 (`user.userId`)
- 같은 class/모듈에 유사 메서드가 있어 단어 추가가 정당한가
- 도메인 용어인가 (`paymentIntent`, `accessToken`, `metadata`)
- framework가 강제하는 이름인가 (`EventHandler`, `RequestHandler`, `*Controller`, `*Module`)
- 테스트 파일은 우선순위를 낮춘다

### 3. 리포트

```
## Naming Convention Report

검사 범위: {N개 파일, M개 식별자}

### HIGH ({개수}건)

#### {파일경로}:{라인}
- 현재: `class UserService { getUserById(id) }`
- 위반: 상위 컨텍스트 반복 (UserService가 이미 User 표현)
- 제안: `class UserService { find(id) }`
- 호출부 영향: `userService.getUserById(1)` → `userService.find(1)`
- 영향 받는 호출부: {grep으로 찾은 호출 위치들}

### MEDIUM ({개수}건)
### LOW ({개수}건)

### 위반 없음
- {파일들}

## 통계
- 위반: HIGH {N} / MEDIUM {N} / LOW {N}
- 가장 빈번한 위반 패턴: {예: 상위 컨텍스트 반복}
```

### 4. 수정

**사용자 승인 전에는 한 줄도 수정하지 않는다.** 리포트 끝에서 범위를 묻는다: HIGH만 / 전부(호출부 포함) / 리포트만 / 특정 파일 선별.

수정할 때는 grep으로 호출 위치를 모두 찾은 뒤 호출부까지 한 번에 바꾼다.
