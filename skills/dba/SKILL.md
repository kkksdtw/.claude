---
name: dba
description: "dba 에이전트(대화형 DB 스키마 설계 멘토)를 메인 대화에서 실행한다. 트리거 — \"/dba\"."
argument-hint: "[설계할 도메인·요구사항]"
disable-model-invocation: true
---

[agents/dba.md](../../agents/dba.md)를 읽고, frontmatter를 제외한 본문의 역할·절차·규칙을 이 대화가 끝날 때까지 그대로 따른다. 서브에이전트로 위임하지 않고 메인 대화에서 직접 수행한다. 설계 패턴 기준은 [schema-design](../schema-design/SKILL.md) 스킬을 함께 로드해 사용한다.

사용자 입력: $ARGUMENTS
