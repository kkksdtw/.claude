---
name: ci-debug
description: "실패한 GitHub Actions run을 디버깅한다 — 실패 run·스텝 로그 수집, 원인 분류, 수정 방향. 트리거 — \"CI 깨졌어\", \"워크플로우 실패\", \"액션이 왜 실패했지\", \"/ci-debug\"."
argument-hint: "[run-id | 워크플로우명] (생략 시 최근 실패 run)"
---

# CI Debug — 실패한 GitHub Actions run 디버깅

```
/ci-debug [run-id | 워크플로우명]   # 인자 없으면 최근 실패 run
```

> 지식: [github-actions](../github-actions/SKILL.md) · 안전: [safety.md](../../rules/devops/safety.md)
> `gh run view`는 읽기(자동). `gh run rerun`/`workflow run`은 변경+외부영향(승인).

## Step 1: 실패 run 찾기 (읽기)

```bash
gh run list --limit 10                              # 인자 없을 때
gh run list --workflow "<name>" --limit 10          # 워크플로우 지정
```
가장 최근 `failure`/`startup_failure` run을 고른다(또는 인자의 run-id).

## Step 2: 실패 로그 (읽기)

```bash
gh run view <run-id>                                # 잡/스텝 개요
gh run view <run-id> --log-failed                   # 실패 스텝 로그만
gh run view <run-id> --job <job-id> --log           # 특정 잡 전체
```
실패한 **스텝과 명령**, 종료코드, 핵심 에러 라인을 짚는다.

## Step 3: 원인 분류

- **코드/테스트**: 앱 버그·테스트 실패 → 코드 수정.
- **환경/의존성**: 캐시·버전·툴 누락 → 워크플로우/setup 수정.
- **인증/권한**: OIDC role, ECR 권한, `permissions:`, 시크릿 → [github-actions](../github-actions/SKILL.md) 보안 항목.
- **인프라**: 러너·네트워크·레이트리밋 → 재시도 성격인지 판단.
- **GitOps 배포**: 매니페스트 태그 갱신/커밋 단계 실패 → 권한·경로 확인. (CI가 kubectl로 직접 배포 중이면 안티패턴, cicd-reviewer로 점검)

## Step 4: 수정 & 검증

- 워크플로우 파일 수정은 **로컬 변경**(자동 가능). `actionlint`로 검증.
- 가능하면 실패 명령을 로컬에서 재현해 고친 뒤 푸시.
- `gh run rerun <run-id>`로 재실행은 **승인** 후. push로 자연 트리거되는 경우 그쪽을 우선.

## Rules

- 로그는 읽기 전용으로 수집. 재실행/트리거는 승인.
- 시크릿이 로그에 찍혔으면 노출로 보고하고 로테이션을 권한다 ([safety.md](../../rules/devops/safety.md) §3).
- 같은 실패가 반복되면 근본 원인(캐시 키/권한 등)을 고치고 단순 재시도로 덮지 않는다.
