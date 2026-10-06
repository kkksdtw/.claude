---
name: github-actions
description: "GitHub Actions 작업 규칙 — CI→ECR→매니페스트→GitOps 배포 흐름, OIDC·action SHA 핀·최소권한 보안, 작성 컨벤션, 디버깅 명령. .github/workflows를 작성·수정·리뷰하거나 CI 실행을 다룰 때 사용한다."
---

# GitHub Actions 규칙

> 실행 안전(읽기 자동/변경 승인)은 [safety.md](../../rules/devops/safety.md)를 따른다.
> 워크플로우 리뷰는 **cicd-reviewer** agent, 실패 디버깅은 `/ci-debug`로 진행한다.

## 이 환경의 배포 흐름: CI → ECR → 매니페스트 → GitOps

```
push/tag → build → test → docker build → ECR push
        → 매니페스트 레포(또는 디렉토리)의 이미지 태그 갱신 (commit/PR)
        → [여기서 GHA의 역할 끝]
        → ArgoCD/Flux가 git을 감지해 클러스터에 동기화
```

### 핵심 규칙

- **CI 잡에서 `kubectl apply`·`helm upgrade`로 클러스터에 직접 배포하지 않는다.** GitOps 안티패턴이다. CI는 **이미지 태그 갱신(git write)까지**만 한다.
- "배포 완료"는 GHA 잡 성공이 아니라 **ArgoCD sync + Healthy** 시점이다. 배포 검증은 ArgoCD 상태로 한다 ([eks](../eks/SKILL.md)).
- 이미지 태그는 가변(`latest`)이 아니라 불변(commit SHA/버전)으로 박는다.

## 보안 (cicd-reviewer 핵심 점검 항목)

- **AWS 인증은 OIDC**로. 장기 access key를 secret에 넣지 않는다.
  ```yaml
  permissions:
    id-token: write          # OIDC
    contents: read
  steps:
    - uses: aws-actions/configure-aws-credentials@<commit-sha>
      with:
        role-to-assume: arn:aws:iam::<acct>:role/<ci-role>
        aws-region: <region>
  ```
- **third-party action은 commit SHA로 핀 고정**한다 (`@v4` 태그 X → 공급망 위험). first-party(`actions/*`)도 가급적 SHA.
- `GITHUB_TOKEN` permissions를 워크플로우 최상단에서 **최소권한**으로 명시한다.
- `pull_request_target` + PR head 체크아웃 + 시크릿 노출 조합은 위험 — fork PR에서 시크릿 탈취 경로.
- `run:`에 `${{ github.event.* }}`(PR 제목/브랜치명 등)를 직접 보간하지 않는다 → 셸 인젝션. env로 받아 따옴표 처리.
- 시크릿을 `echo`하거나 로그에 남기지 않는다.

## 작성 컨벤션

- `concurrency`로 중복 실행 취소(브랜치별).
- 의존성/빌드 **캐시**(`actions/cache` 또는 setup-* 내장 cache).
- `timeout-minutes`로 무한 잡 방지.
- 공통 로직은 **reusable workflow / composite action**으로.
- matrix로 병렬화하되 fail-fast 정책을 의도적으로 설정.

## 디버깅

```bash
gh run list --workflow <name> --limit 10        # 최근 실행 (읽기)
gh run view <run-id> --log-failed               # 실패 스텝 로그만 (읽기)
gh run view <run-id> --job <job-id> --log       # 특정 잡 전체 로그
actionlint .github/workflows/*.yml              # 정적 검사 (설치 시)
```

- 실패 step → 명령/환경을 로컬에서 재현 → 수정은 워크플로우 **파일 편집(로컬 변경)**.
- `gh run rerun` / `gh workflow run`은 **변경 + 외부 영향** → 승인 ([safety.md](../../rules/devops/safety.md)).
