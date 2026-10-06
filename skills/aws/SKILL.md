---
name: aws
description: "AWS 작업 규칙 — 비용은 범위 밖(MSP), 인증·컨텍스트 확인, 읽기 전용 인벤토리와 관리 주체(콘솔/Terraform) 표시, 보안 점검 항목, 시크릿·변경 정책. aws CLI를 쓰거나 AWS 자원을 조회·점검·변경할 때 사용한다."
---

# AWS 규칙

> 실행 안전(읽기 자동/변경 승인)은 [safety.md](../../rules/devops/safety.md)를 따른다.
> 읽기 전용 감사는 **aws-auditor** agent, 자원 조회는 `/aws-inventory`로 진행한다.

## 비용은 범위 밖 (MSP)

**회사가 MSP 계약 중이라 AWS 비용은 별도 대시보드에서 관리된다.**

- Cost Explorer / Billing / `ce get-cost-and-usage` 등 **비용·청구 조회를 하지 않는다.**
- 비용 질문을 받으면 분석을 시도하지 말고 **MSP 대시보드를 안내**한다.
- 단, 비용에 영향을 주는 **리소스 상태**(미사용 EIP, 떠있는 인스턴스, 미연결 EBS 등)는 인벤토리/감사 관점에서 보고할 수 있다 — 금액 산정은 하지 않는다.

## 인증 / 컨텍스트

```bash
aws sts get-caller-identity         # account + principal — 항상 먼저
aws configure list                  # profile / region
echo "$AWS_PROFILE / ${AWS_REGION:-$AWS_DEFAULT_REGION}"
```

- 인증은 **AWS SSO / named profile**. multi-account 가능성을 항상 의심하고, 작업 대상 account·region을 명시한다 ([safety.md](../../rules/devops/safety.md) §0).
- 리전을 가정하지 않는다 — 자원은 리전별로 흩어져 있을 수 있다.

## 읽기 전용 인벤토리

`describe-*` / `list-*` / `get-*`는 자동 실행. 자원을 나열할 때 **콘솔 관리 vs Terraform 관리**를 함께 표시한다:

- `ManagedBy=terraform`(또는 프로젝트 표준) 태그 유무로 1차 판별.
- 확실히 하려면 `terraform state list`와 대조 (`/tf-drift`).
- 태그 없는 자원은 콘솔 관리(legacy) 후보 → import 검토.

## 보안 점검 (읽기, aws-auditor 핵심)

| 영역 | 확인 |
|------|------|
| Security Group | `0.0.0.0/0` 인바운드(특히 22/3389/DB 포트) |
| IAM | wildcard(`*:*`)·과다권한 정책, 미사용 권한, 오래된 access key, MFA 미설정 |
| S3 | public 버킷/ACL, 암호화·버저닝 미설정, 퍼블릭 액세스 차단 해제 |
| 암호화 | EBS/RDS/S3 미암호화, 기본 KMS vs CMK |
| 노출 | public RDS, public AMI/EBS 스냅샷, 공개 ECR |
| EKS | 퍼블릭 API endpoint, 노드 IAM, IRSA 구성 |

## 시크릿

`secretsmanager get-secret-value`, `ssm get-parameter --with-decryption`로 **값**을 꺼내는 것은 읽기여도 승인 — 존재·이름까지만 보고한다 ([safety.md](../../rules/devops/safety.md) §3).

## 변경

모든 `create/update/delete/put/modify/run/terminate/attach/authorize` 류는 승인. 가능하면 콘솔 직접 변경 대신 **Terraform으로** 반영해 IaC 일관성을 유지한다 ([terraform](../terraform/SKILL.md)).
