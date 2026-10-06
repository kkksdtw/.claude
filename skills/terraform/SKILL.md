---
name: terraform
description: "Terraform 작업 규칙 — 콘솔↔IaC 분리 환경, plan→apply 규율, state 안전, 작성 컨벤션, drift 분류. .tf·terragrunt 파일을 작성·수정·리뷰하거나 terraform plan/apply/import/state를 다룰 때 사용한다."
---

# Terraform 규칙

> 실행 안전(읽기 자동/변경 승인)은 [safety.md](../../rules/devops/safety.md)를 따른다.
> import·drift 작업은 `/tf-import`, `/tf-drift` command로 진행한다.

## 이 환경의 현실: 콘솔 ↔ IaC 분리

AWS 자원이 두 갈래로 관리된다.

- **콘솔 관리 (legacy)**: 입사 이전에 콘솔에서 수동 생성된 자원. Terraform state에 없다.
- **Terraform 관리**: 입사 이후 IaC로 작성된 자원.

원칙:
- **신규 자원은 전부 Terraform으로** 작성한다.
- 콘솔 관리 자원은 가능한 것부터 **import로 IaC에 흡수**한다 (`/tf-import`).
- 자원이 어느 쪽인지 헷갈리면 `terraform state list`와 실제 AWS를 대조한다 (`/tf-drift`).
- import 전까지는 콘솔 자원을 Terraform에서 참조만 하고(`data` source) 관리하지 않는다.

## 도구 / 레이아웃 감지

작업 시작 시 탐지한다 (가정하지 말 것):

```bash
terraform version
ls *.tf backend.tf 2>/dev/null            # backend (대개 s3 + dynamodb lock)
cat terragrunt.hcl 2>/dev/null            # terragrunt 사용 시 terragrunt 명령으로
terraform workspace list 2>/dev/null      # workspace 분리 여부
```

- `terragrunt.hcl`이 있으면 `terragrunt`로 호출하고 없으면 `terraform`을 직접 쓴다.
- backend가 원격(S3)이면 state lock(DynamoDB)이 걸린다 — 동시 실행·강제 unlock 주의.
- 환경 분리가 디렉토리(`envs/prod`, `envs/stg`)인지 workspace인지 파악하고, **prod 대상 작업은 [safety.md](../../rules/devops/safety.md) §0** 컨텍스트 확인을 거친다.

## plan → apply 규율

1. `terraform fmt -recursive` + `terraform validate` (읽기).
2. `terraform plan -out=tfplan` (읽기, 자동). 변경이 자명하지 않으면 **terraform-reviewer** agent로 plan을 검토한다.
3. plan 요약을 보여준다: `+N 추가 / ~N 변경 / -N 삭제 / -/+N 교체`.
4. **파괴/교체(replace)·데이터 보유 자원**(RDS, S3+객체, EBS, EFS, DynamoDB 테이블, EKS nodegroup 등)이 있으면 강조하고 승인을 받는다.
5. 승인 후 `terraform apply tfplan`. 가능하면 직접 apply보다 **CI(GitHub Actions/PR) 경유**를 우선한다.

## state 안전

- `state rm/mv/push`, `import`, `-auto-approve`는 항상 승인. 원격 state는 잘못 건드리면 복구가 어렵다.
- state 조작 전 백업: `terraform state pull > state.backup.json`.
- lock이 걸렸으면 원인(다른 실행/CI)을 먼저 확인하고, `force-unlock`은 최후의 수단 + 승인.

## 작성 컨벤션

- 모든 자원에 식별 태그를 단다 — 콘솔/IaC 구분에 쓰인다: `ManagedBy = "terraform"`, `Environment`, `Service`(가능하면 `default_tags`로 일괄).
- provider·module version을 핀 고정한다 (`required_providers`, module `version`).
- 변수/출력/자원 이름은 [naming-conventions](../../rules/common/naming-conventions.md)를 따른다 — 모듈명이 이미 표현하는 컨텍스트를 자원명에서 반복하지 않는다.
- 시크릿을 HCL·tfvars·state 평문에 넣지 않는다. SSM/Secrets Manager + `data` source 또는 CI 주입을 쓴다.

## drift

- **managed drift**: state에 있는 자원이 콘솔에서 손으로 바뀜 → `terraform plan`이 차이를 보여준다.
- **unmanaged**: AWS에 존재하나 state에 없음 → 콘솔 관리 자원, import 후보.
- **orphaned**: state에 있으나 AWS에 없음 → 수동 삭제됨, 정리 필요.

자세한 탐지·리포트는 `/tf-drift`.
