---
name: tf-drift
description: "콘솔↔Terraform 정합성을 읽기 전용으로 점검한다 — managed drift / unmanaged(import 후보) / orphaned 분류. 트리거 — \"drift 확인\", \"state랑 실제가 맞는지\", \"콘솔에서 바뀐 거 있나\", \"/tf-drift\"."
argument-hint: "[범위] (예: sg, module.vpc / 생략 시 전체)"
---

# Drift — 콘솔 ↔ Terraform 정합성 점검

state와 실제 AWS를 대조해 3종류의 불일치를 분류한다. **읽기 전용.**

```
/tf-drift [범위]      # 예: /tf-drift           (전체)
                         #     /tf-drift sg          (security group만)
                         #     /tf-drift module.vpc  (특정 모듈)
```

> 지식: [terraform](../terraform/SKILL.md), [aws](../aws/SKILL.md) · 안전: [safety.md](../../rules/devops/safety.md)

## Step 0: 컨텍스트

```bash
aws sts get-caller-identity --query '[Account,Arn]' --output text
terraform version; cat terragrunt.hcl 2>/dev/null
```

## Step 1: managed drift (state에 있는 자원이 콘솔에서 변경됨)

```bash
terraform plan -refresh-only -no-color        # 읽기, out-of-band 변경 감지
# 또는 일반 plan으로 차이 확인
```
plan이 보여주는 차이 = 콘솔에서 손으로 바꾼 부분. 자명하지 않으면 **terraform-reviewer**로 검토.

## Step 2: unmanaged (AWS에 있는데 state엔 없음 = 콘솔 관리, import 후보)

state 자원과 실제 자원을 대조한다:

```bash
terraform state list                          # TF가 아는 자원
aws <svc> describe-*/list-*                    # 실제 자원 (범위에 맞춰)
```
- 범위 인자가 있으면 해당 타입만(예: `sg` → `describe-security-groups`), 없으면 핵심 타입(EC2, SG, RDS, S3, IAM role, EKS, ELB 등) 위주로.
- `ManagedBy=terraform` 태그 유무로 1차 판별, state 대조로 확정.
- 광범위 스캔은 **aws-auditor** agent에 위임 가능.

## Step 3: orphaned (state엔 있는데 실제 없음)

state 자원이 실제 AWS 조회에서 사라졌으면 수동 삭제됨 → state 정리 필요(`state rm`은 승인).

## Step 4: 리포트

```
## Drift Report — account={…} region={…}

### 🔴 managed drift (콘솔에서 변경됨, N건)
- {resource.addr}: {바뀐 속성} — TF apply로 되돌릴지 / 코드에 반영할지 결정 필요

### 🟡 unmanaged (콘솔 관리, import 후보, N건)
- {타입/ID}: 태그 {유무} → `/tf-import` 후보

### ⚪ orphaned (state에만 존재, N건)
- {resource.addr}: 실제 없음 → state 정리(`state rm`, 승인) 검토

### 요약
managed drift {N} / unmanaged {N} / orphaned {N}
권장 순서: {예: 우선 unmanaged 중 핵심 자원부터 import}
```

## Rules

- 전부 읽기. `state rm`·apply는 별도 승인 단계로만.
- 비용은 다루지 않는다 (MSP). 유휴 자원은 상태로만 보고.
- 전체 스캔이 무거우면 범위를 좁히도록 사용자에게 제안한다.
