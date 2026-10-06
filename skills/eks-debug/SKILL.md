---
name: eks-debug
description: "EKS 서비스 장애를 읽기 전용으로 진단한다(GitOps-first). pod가 안 뜨거나 죽을 때, 배포가 반영되지 않을 때 사용한다 — CrashLoopBackOff, ImagePullBackOff, OOMKilled, Pending, ArgoCD OutOfSync. 트리거 — \"pod가 죽어\", \"배포가 안 돼\", \"/eks-debug\"."
argument-hint: "<서비스|pod|namespace>"
---

# EKS Debug — GitOps 서비스 장애 진단

EKS 서비스가 안 뜨거나·배포가 안 되거나·죽는 원인을 읽기 전용으로 추적한다.

```
/eks-debug <서비스/pod/namespace>    # 예: /eks-debug payment-api
```

> 지식: [eks](../eks/SKILL.md) · 안전: [safety.md](../../rules/devops/safety.md)
> 깊은 진단은 **eks-doctor** agent에 위임한다.

## Step 0: 컨텍스트 확인 (필수)

```bash
kubectl config current-context
kubectl config view --minify -o jsonpath='{..namespace}'
```
잘못된 클러스터를 진단하면 무의미. prod면 대상 확인받고 진행.

## Step 1: 진단 순서 (GitOps-first)

`eks` 스킬을 로드해 **디버깅 방법론** 순서(ArgoCD/Flux → Workload → Events → Logs → Resources → Networking)대로 진단하고, 증상은 **흔한 실패 모드** 표로 좁힌다. 복잡하면 **eks-doctor** agent를 띄운다.

배포 경로 문제(git 태그 ≠ live 태그, `OutOfSync`/`SyncFailed`)면 `/ci-debug`로 넘긴다.

## Step 2: 결과

```
컨텍스트: {context}/{ns}
근본 원인: {한 문장}
증거: {명령 → 핵심 출력}
조치(GitOps): git 매니페스트 {수정점} → commit/PR → ArgoCD sync
  (직접 kubectl 변경 필요 시: 승인 + git 반영 필수)
```

## Rules

- 읽기 전용 kubectl만. `apply/delete/edit/scale/exec`는 승인 + GitOps에선 git으로 대체.
- 시크릿 값 출력 금지 ([safety.md](../../rules/devops/safety.md) §3).
- 배포 미반영은 클러스터가 아니라 파이프라인 문제일 수 있다 — ArgoCD부터 본다.
