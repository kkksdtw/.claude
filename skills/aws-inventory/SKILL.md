---
name: aws-inventory
description: "특정 타입의 AWS 자원을 읽기 전용으로 나열하고 관리 주체(콘솔/Terraform)를 함께 표시한다. 비용은 다루지 않는다. 트리거 — \"EC2 목록\", \"어떤 RDS가 있지\", \"자원 현황\", \"/aws-inventory\"."
argument-hint: "<자원타입> [region]"
---

# Inventory — AWS 자원 조회 + 관리 주체 표시

특정 타입의 AWS 자원을 읽기 전용으로 나열하고, **콘솔 관리 vs Terraform 관리**를 함께 표시한다.

```
/aws-inventory <자원타입> [region]
# 예: /aws-inventory ec2 / rds / s3 / sg / iam-roles / eks / elb / eip
```

> 지식: [aws](../aws/SKILL.md) · 안전: [safety.md](../../rules/devops/safety.md)
> 전부 읽기. **비용은 다루지 않는다(MSP 대시보드).**

## Step 0: 컨텍스트

```bash
aws sts get-caller-identity --query '[Account,Arn]' --output text
echo "region=${2:-${AWS_REGION:-$AWS_DEFAULT_REGION}}"
```
multi-account/region 가능 — 대상을 명확히 한다.

## Step 1: 자원 조회 (읽기)

타입에 맞는 describe/list (예시):

| 타입 | 명령 |
|------|------|
| ec2 | `aws ec2 describe-instances` |
| rds | `aws rds describe-db-instances` |
| s3 | `aws s3api list-buckets` |
| sg | `aws ec2 describe-security-groups` |
| iam-roles | `aws iam list-roles` |
| eks | `aws eks list-clusters` + `describe-cluster` |
| elb | `aws elbv2 describe-load-balancers` |
| eip | `aws ec2 describe-addresses` |

광범위하면 **aws-auditor** agent에 위임.

## Step 2: 관리 주체 판별

- 태그 `ManagedBy=terraform`(또는 프로젝트 표준) 유무.
- 확실히 하려면 `terraform state list`와 대조 → state에 없으면 **콘솔 관리(import 후보)**.

## Step 3: 리포트

```
## Inventory: <타입> — account={…} region={…}

| 자원 | ID/이름 | 관리 | 비고 |
|------|---------|------|------|
| … | … | TF / 콘솔 / ? | (퍼블릭/미연결 등 상태) |

요약: 총 {N} (TF {N} / 콘솔 {N})
콘솔 관리 {N}건 → `/tf-import` 후보
```

## Rules

- 읽기 전용. 변경 명령 금지.
- 금액·비용 산정 안 함. 유휴/미연결은 **상태**로만 표시 (미사용 EIP, 미연결 EBS 등).
- 시크릿 값 조회 금지 ([safety.md](../../rules/devops/safety.md) §3).
