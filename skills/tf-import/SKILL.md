---
name: tf-import
description: "콘솔에서 수동 생성된 AWS 자원을 Terraform state로 import해 IaC로 흡수한다. state를 변경하므로 명시 호출 전용."
argument-hint: "<자원 설명 또는 ID>"
disable-model-invocation: true
---

# Terraform Import — 콘솔 자원을 IaC로 흡수

콘솔에서 수동 생성된 AWS 자원을 Terraform state로 가져와 IaC로 관리한다.

```
/tf-import <자원 설명 또는 ID>     # 예: /tf-import "prod ALB security group"
```

> 지식: [terraform](../terraform/SKILL.md) · 안전: [safety.md](../../rules/devops/safety.md)
> `terraform import`는 **state 변경 → 승인 필요**.

## Step 0: 컨텍스트 확인

```bash
aws sts get-caller-identity --query '[Account,Arn]' --output text
terraform version; cat terragrunt.hcl 2>/dev/null
```
대상 account/region과 도구(terraform/terragrunt)를 확인한다. prod면 강조.

## Step 1: 대상 자원 식별 (읽기)

- 자원의 실제 ID/ARN을 찾는다: `aws <svc> describe-*`/`list-*` (읽기, 자동).
- 이미 state에 있는지 확인: `terraform state list | grep -i <name>`. 있으면 import 불필요.
- 모호하면 **aws-auditor** agent로 후보를 좁힌다.

## Step 2: HCL 작성

대상 자원에 대응하는 `resource` 블록을 작성한다.

- **Terraform 1.5+**: `import` 블록 + `terraform plan -generate-config-out=generated.tf`로 HCL 초안 생성 후 정리(권장).
- 그 외: 기존 유사 자원·provider 문서를 참고해 손으로 작성.
- 식별 태그(`ManagedBy=terraform` 등)와 이름 컨벤션을 맞춘다.

## Step 3: import 실행 (승인)

state를 백업하고 import한다 — **변경이므로 승인을 받는다**.

```bash
terraform state pull > state.backup.json      # 백업 (읽기)
terraform import <resource.addr> <real-id>     # ⚠️ 승인 후
# 1.5+ import 블록 방식이면: terraform apply (import 반영)
```

## Step 4: 검증 (필수)

```bash
terraform plan
```
- **No changes** 면 성공 — HCL이 실제 자원과 일치.
- diff가 있으면 HCL을 실제 상태에 맞게 **수정**하고 plan을 다시 돌린다 (자원을 바꾸는 게 아니라 코드를 맞춘다). diff가 0이 될 때까지 반복.

## Step 5: 보고

```
import 완료: <resource.addr> ← <real-id>
plan diff: 0 (일치) / 또는 남은 차이 {…}
state 백업: state.backup.json
후속: 같은 종류의 미관리 자원 {목록} 도 import 후보
```

## Rules

- `terraform import` 전 항상 state 백업 + 승인.
- 자원을 바꾸지 않는다 — HCL을 실제에 맞춘다 (drift 0이 목표).
- 여러 자원 일괄 import는 하나 검증 후 진행한다.
