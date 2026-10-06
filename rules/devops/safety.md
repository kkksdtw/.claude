# Infra 실행 안전 정책

> 모든 DevOps agent·command·skill이 따르는 **단일 안전 기준**이다.
> 정책: **읽기는 자동 실행, 변경(mutation)은 항상 사용자 승인 후 실행.**

## 0. 실행 전 컨텍스트 확인 (MOST IMPORTANT)

어떤 인프라 명령이든 실행하기 전에 **대상이 어디인지** 먼저 확인하고 사용자에게 한 줄로 보고한다.

```bash
aws sts get-caller-identity --query '[Account,Arn]' --output text   # account / principal
echo "region=${AWS_REGION:-$AWS_DEFAULT_REGION} profile=${AWS_PROFILE:-default}"
kubectl config current-context                                       # kube context
```

- prod 계정/컨텍스트로 추정되면 **읽기라도** 한 번 멈추고 대상을 확인받는다.
- 의도한 계정·리전·컨텍스트가 아니면 즉시 중단한다. 절대 prod에 우발적으로 손대지 않는다.
- mutation은 대상 컨텍스트를 사용자가 명시적으로 확인해야 진행한다.

## 1. 명령 분류 — 읽기(자동) vs 변경(승인)

아래 "변경"에 해당하면 실행 전 **무엇이·어디서·어떻게 바뀌는지** diff/plan으로 보여주고 승인을 받는다.

| 도구 | 읽기 (자동 실행) | 변경 (승인 필요) |
|------|------------------|------------------|
| terraform | `validate`, `fmt -check`, `plan`, `show`, `state list`, `state show`, `providers`, `output`, `version` | `apply`, `destroy`, `import`, `state rm/mv/push`, `taint`, `untaint`, `workspace new/delete`, `init`(provider 다운로드는 가능, backend 변경은 승인) |
| kubectl | `get`, `describe`, `logs`, `top`, `events`, `explain`, `api-resources`, `rollout status/history`, `auth can-i` | `apply`, `create`, `delete`, `edit`, `patch`, `scale`, `replace`, `rollout restart/undo`, `cordon`, `drain`, `exec`, `cp`, `label`, `annotate` |
| aws | `describe-*`, `list-*`, `get-*`, `s3 ls` | `create-*`, `update-*`, `delete-*`, `put-*`, `modify-*`, `run-*`, `terminate-*`, `attach/detach`, `authorize/revoke`, `s3 cp/rm/sync`(쓰기) |
| argocd | `app get/list/diff/history`, `app resources` | `app sync`, `app rollback`, `app set`, `app delete`, `app create` |
| gh | `run list/view`, `run download`, `workflow list/view`, `pr view`, `api`(GET) | `run rerun/cancel`, `workflow run/enable/disable`, `pr merge`, `api`(POST/PATCH/DELETE) |
| git | `status`, `diff`, `log`, `show`, `branch` | `commit`, `push`, `rebase`, `reset --hard`, `clean` (사용자가 명시 요청 시에만) |

> 분류가 모호하면 **변경으로 간주**하고 승인을 받는다.

## 2. mutation 승인 프로토콜

1. **미리보기**: `terraform plan`, `kubectl diff`, `argocd app diff`, `git diff` 등으로 실제 변경분을 보여준다.
2. **영향 요약**: 파괴/교체(replace)/데이터 손실 가능 자원을 한 줄로 강조한다.
3. **대상 재확인**: account / region / context를 명시한다.
4. 승인 후 실행하고, 실행 결과를 그대로 보고한다.

## 3. 비밀값 보호

- secret **값** 조회는 읽기여도 승인을 받는다: `aws secretsmanager get-secret-value`, `aws ssm get-parameter --with-decryption`, `kubectl get secret -o yaml/jsonpath`(base64 디코딩 포함).
- 조회한 비밀값은 화면·로그·커밋에 남기지 않는다. 존재 여부·키 이름까지만 보고한다.

## 4. 절대 하지 말 것

- 대상 컨텍스트(account/region/cluster) 확인 없이 mutation 실행.
- `terraform state rm/push`, `terraform apply -auto-approve`를 승인 없이 실행.
- GitOps 클러스터에 `kubectl apply/edit`로 직접 변경 (→ ArgoCD가 되돌리고 drift만 남는다. git을 통해 변경한다. [eks](../../skills/eks/SKILL.md) 참고).
- `kubectl delete`, `aws ... delete-*`를 미리보기·승인 없이 실행.
- **사용자 승인 없이** main/master 브랜치에 직접 commit. (승인 게이트를 거친 워크플로우 — 예: orchestrate main 모드의 Gate 3 — 는 예외)
- 비용 분석/청구 데이터 조회 — **MSP 대시보드에서 별도 관리됨**. [aws](../../skills/aws/SKILL.md) 참고.
