# Agent Orchestration

## Available Agents

Located in `~/.claude/agents/`:

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| architect | System design | Architectural decisions |
| schema-designer | Database schema design | Schema changes, creating |
| api-designer | REST API design review | API endpoint design, contract review |
| code-reviewer | Code review | After writing code |
| security-reviewer | Security analysis | Before commits |
| performance-reviewer | Performance review | Query, rendering, bundle optimization |
| ux-reviewer | Frontend UX review | Accessibility, responsive, interaction |
| build-error-resolver | Fix build errors | When build fails |
| terraform-reviewer | Terraform plan·HCL 안전성 리뷰 | apply 전, .tf 변경·import 검토 |
| eks-doctor | EKS/Kubernetes 장애 진단 (GitOps) | pod/배포 장애, CrashLoop·OOM·OutOfSync |
| cicd-reviewer | GitHub Actions 워크플로우 리뷰 | .github/workflows 작성·수정 후 |
| aws-auditor | AWS 읽기 전용 보안·정합성 감사 | 보안 점검, 콘솔↔IaC 격차 (비용 제외) |

> DevOps agent의 실행 안전 기준은 [rules/devops/safety.md](../devops/safety.md) (읽기 자동 / 변경 승인).

## Immediate Agent Usage

No user prompt needed:
1. Code just written/modified - Use **code-reviewer** agent
2. Backend bug fix or feature - Use **tdd-nestjs** skill
3. Frontend bug fix or feature - Use **tdd-react** skill
4. Architectural decision - Use **architect** agent
5. Schema changes or creating - Use **schema-designer** agent

## Parallel Task Execution

ALWAYS use parallel Task execution for independent operations:

```markdown
# GOOD: Parallel execution
Launch 3 agents in parallel:
1. Agent 1: Security analysis of auth.ts
2. Agent 2: Performance review of cache system
3. Agent 3: Type checking of utils.ts

# BAD: Sequential when unnecessary
First agent 1, then agent 2, then agent 3
```

## Multi-Perspective Analysis

For complex problems, use split role sub-agents:
- Factual reviewer
- Senior engineer
- Security expert
- Consistency reviewer
- Redundancy checker
