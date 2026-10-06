# Test DB Isolation

## 목적

orchestrate 워크플로우가 병렬로 실행될 때 DB 충돌을 방지한다.
각 워크플로우는 독립된 테스트 DB를 사용하고, 완료 후 자동 삭제한다.

격리를 유지하면서 두 가지 비용을 **구조적으로** 제거한다:

- **마이그레이션 반복** — 스키마가 그대로면 마이그레이션을 다시 돌리지 않는다 (템플릿 DB 복제).
- **시크릿 노출** — `DATABASE_URL` 값을 에이전트 컨텍스트에 넣지 않는다 (셸이 로드한다).

## 안전 원칙: 로컬 격리 DB 전용 (MOST IMPORTANT)

이 프로토콜은 **로컬 격리 테스트 DB에서만** 동작한다.

- **로컬이면 파괴적 DDL 자동 허용**: 대상이 로컬임이 확인되면 파괴적 DDL(테이블/컬럼 drop, 데이터 유실형 마이그레이션 등)을 **사용자 승인 없이 자동 실행**한다. 대상 DB는 이 프로토콜이 만든 폐기용 임시 DB이므로 잃을 데이터가 없다 — orchestrate 자율 모드 [에스컬레이션 조건](../SKILL.md#autonomy-mode-게이트-자동-통과-vs-승인) 2번에서도 이 실행은 예외다.
- **공식 환경 절대 금지**: 감지한 host가 로컬이 아니면(원격 = staging·운영 후보) 이 프로토콜을 **즉시 중단(STOP)**하고 사용자에게 알린다. 파괴적 DDL은 물론 **어떤 마이그레이션·테스트도 공식 환경 DB에 실행하지 않는다.**

**로컬 판정 기준** — host가 아래 중 하나면 로컬로 간주한다:

- `localhost` / `127.0.0.1` / `::1` / `0.0.0.0`
- 파일·소켓 기반: SQLite(`file:`, `*.sqlite`, `*.db`), 유닉스 도메인 소켓
- `docker-compose`가 정의한 로컬 서비스 호스트(예: `db`·`postgres`·`mysql` 등 compose 네트워크 내부 이름) — compose 파일에서 로컬 컨테이너임이 확인될 때

그 외(RDS 엔드포인트 `*.rds.amazonaws.com`, 공인 도메인/IP 등)는 **원격 = 공식 환경 후보**로 보고 STOP한다. **애매하면 원격으로 간주**하고 사용자에게 확인한다.

## 원칙: 값을 읽지 말고 셸이 로드한다 (MOST IMPORTANT)

`.env`·`.env.test`를 **Read 도구로 읽지 않는다.** [guard-rails](../../guard-rails/SKILL.md)가 차단하는 대상이고, 차단을 `cat`·`grep`·`sed`로 우회하는 것은 더 나쁘다 — credential이 컨텍스트와 로그에 남는다.

에이전트가 알아야 하는 것은 **DB 종류·host·DB 이름** 셋뿐이다. user·password·port는 알 필요가 없다. 셸이 파일을 로드하고 필요한 조각만 출력한다.

**감지 스니펫** — 이 형태 그대로 실행한다. credential은 stdout에 나오지 않는다:

```bash
set -a; . ./.env.test 2>/dev/null || . ./.env; set +a
echo "type=${DATABASE_URL%%:*}"
echo "host=$(printf '%s' "$DATABASE_URL" | sed -E 's#^[^:]+://([^@]*@)?([^:/?]+).*#\2#')"
echo "db=$(basename "${DATABASE_URL%%\?*}")"
```

**URL 치환 3줄** — DB 이름만 바꾼 URL을 export한다. 쿼리스트링(`?schema=public` 등)은 보존된다.
아래 모든 단계에서 이 3줄을 인라인으로 반복한다 (Bash 호출 간 셸 상태는 유지되지 않는다):

```bash
set -a; . ./.env.test 2>/dev/null || . ./.env; set +a
DB_BASE=${DATABASE_URL%%\?*}
export DATABASE_URL="${DB_BASE%/*}/${TARGET_DB}${DATABASE_URL#"$DB_BASE"}"
```

> `DATABASE_URL` 외의 변수명을 쓰는 프로젝트(예: `DB_HOST` + `DB_PORT` + `DB_NAME` 분리형)는
> 같은 방식으로 해당 변수만 override한다. 이때도 값을 출력하지 않는다.

---

## 프로토콜

### 1. 기존 테스트 DB 확인

state.json에 `testDatabase.name`이 있고 실제 DB가 존재하면 **그대로 재사용**한다 → 5단계(테스트 실행)로 바로 간다.
없으면 2단계부터 진행한다.

### 2. DB 종류·로컬 여부 감지

위 **감지 스니펫**을 실행해 `type`·`host`·`db`를 얻는다.

| 출력된 `type` | DB 종류 |
|-------------|---------|
| `postgresql` / `postgres` | PostgreSQL |
| `mysql` | MySQL |
| `mongodb` / `mongodb+srv` | MongoDB |
| `file`, 또는 경로가 `*.sqlite`·`*.db` | SQLite |
| 감지 실패 | AskUserQuestion으로 사용자에게 질문 |

`host`로 로컬 여부를 판정한다 — 로컬이 아니면 **여기서 STOP**한다.

**마이그레이션 명령어**는 state의 `testDatabase.migrate`에 있으면 그 값을 쓴다.
없을 때만 프로젝트 CLAUDE.md·package.json scripts에서 탐색하고, 찾으면 state에 기록해 재탐색을 없앤다.
탐색 실패 시 AskUserQuestion.

### 3. 이름 결정 — 워크플로우 DB + 템플릿 DB

```bash
# 워크플로우 전용 DB — identifier에서 파생
SUFFIX=$(echo "{identifier}" | tr '-' '_' | tr '[:upper:]' '[:lower:]')
TEST_DB="{원본 db 이름}_${SUFFIX}"        # 예: myapp_test_gifca_123_voucher

# 템플릿 DB — 캐시 키는 마이그레이션 파일 내용 해시
MIG_DIR={프로젝트 마이그레이션 디렉토리}   # 예: prisma/migrations, drizzle, db/migrate
MIG_HASH=$(find "$MIG_DIR" -type f | sort | xargs shasum | shasum | cut -c1-12)
TEMPLATE_DB="orch_tmpl_${MIG_HASH}"
```

> 캐시 키가 **내용 해시**이므로 무효화를 따로 관리하지 않는다 — 스키마가 바뀌면 해시가 달라져
> 새 템플릿이 자동 생성되고, 옛 템플릿은 사용되지 않는다.

### 4. 템플릿 준비(최초 1회) → 복제

> 실행 전 host가 로컬인지 재확인한다(위 [안전 원칙](#안전-원칙-로컬-격리-db-전용-most-important)). 로컬 격리 DB이므로 **파괴적 DDL을 포함한 마이그레이션도 자동 실행**한다. 원격 host면 STOP.
>
> **템플릿 DB에는 접속하지 않는다.** 활성 연결이 있으면 PostgreSQL 복제가 실패한다. 템플릿은 마이그레이션 시점에만 쓰고, 테스트는 항상 복제본에서 돌린다.

**PostgreSQL** — `TEMPLATE` 복제는 물리 복사라 마이그레이션 체인을 재실행하지 않는다:
```bash
if ! psql -lqt | cut -d'|' -f1 | grep -qw "$TEMPLATE_DB"; then
  createdb "$TEMPLATE_DB"
  ( TARGET_DB="$TEMPLATE_DB"
    set -a; . ./.env.test 2>/dev/null || . ./.env; set +a
    DB_BASE=${DATABASE_URL%%\?*}
    export DATABASE_URL="${DB_BASE%/*}/${TARGET_DB}${DATABASE_URL#"$DB_BASE"}"
    {migrate 명령어} )
fi
dropdb --if-exists "$TEST_DB"
createdb -T "$TEMPLATE_DB" "$TEST_DB"
```

**MySQL** — `TEMPLATE`이 없으므로 스키마 덤프를 캐시해 restore한다:
```bash
DUMP="${TMPDIR:-/tmp}/${TEMPLATE_DB}.sql"
if [ ! -f "$DUMP" ]; then
  mysql -u root -e "CREATE DATABASE IF NOT EXISTS \`$TEMPLATE_DB\`;"
  ( TARGET_DB="$TEMPLATE_DB"
    set -a; . ./.env.test 2>/dev/null || . ./.env; set +a
    DB_BASE=${DATABASE_URL%%\?*}
    export DATABASE_URL="${DB_BASE%/*}/${TARGET_DB}${DATABASE_URL#"$DB_BASE"}"
    {migrate 명령어} )
  mysqldump -u root "$TEMPLATE_DB" > "$DUMP"
fi
mysql -u root -e "DROP DATABASE IF EXISTS \`$TEST_DB\`; CREATE DATABASE \`$TEST_DB\`;"
mysql -u root "$TEST_DB" < "$DUMP"
```

**SQLite** — 파일 복사가 곧 복제다:
```bash
TEMPLATE_FILE="${TMPDIR:-/tmp}/${TEMPLATE_DB}.sqlite"
if [ ! -f "$TEMPLATE_FILE" ]; then
  DATABASE_URL="file:${TEMPLATE_FILE}" {migrate 명령어}
fi
cp "$TEMPLATE_FILE" "./${TEST_DB}.sqlite"
```

**MongoDB** — 스키마리스라 템플릿이 무의미하다. 접속 시 자동 생성되므로 마이그레이션만 실행한다:
```bash
( TARGET_DB="$TEST_DB"
  set -a; . ./.env.test 2>/dev/null || . ./.env; set +a
  DB_BASE=${DATABASE_URL%%\?*}
  export DATABASE_URL="${DB_BASE%/*}/${TARGET_DB}${DATABASE_URL#"$DB_BASE"}"
  {migrate 명령어} )
```

### 5. 테스트 실행

서브셸 안에서 URL을 치환해 실행한다. **URL을 인자로 늘어놓지 않는다** — 프로세스 목록과 로그에 남는다:

```bash
( TARGET_DB="$TEST_DB"
  set -a; . ./.env.test 2>/dev/null || . ./.env; set +a
  DB_BASE=${DATABASE_URL%%\?*}
  export DATABASE_URL="${DB_BASE%/*}/${TARGET_DB}${DATABASE_URL#"$DB_BASE"}"
  {commands.test} )
```

### 6. State 기록

state.json에 아래를 기록한다. **URL은 저장하지 않는다** — credential이 디스크에 남는다:

```jsonc
{
  "testDatabase": {
    "name": "myapp_test_gifca_123_voucher",  // 워크플로우 전용 DB
    "template": "orch_tmpl_a1b2c3d4e5f6",    // 재사용 중인 템플릿 (cleanup 대상 아님)
    "type": "postgresql",                     // 감지된 DB 종류
    "migrate": "pnpm prisma migrate deploy"   // 캐시된 마이그레이션 명령 — 재탐색 방지
  }
}
```

---

## Cleanup (자동)

**done.md의 PR 생성 완료 후** 워크플로우 전용 DB를 삭제한다.

> **템플릿 DB(`testDatabase.template`)는 삭제하지 않는다.** 다음 워크플로우가 재사용해야 마이그레이션이
> 반복되지 않는다. 템플릿은 스키마 해시가 바뀌면 자연히 쓰이지 않으므로, 정리는
> `/orchestrate --only cleanup`의 명시적 요청에서만 다룬다.

state.json의 `testDatabase.type`에 따라 실행:

**PostgreSQL:**
```bash
dropdb --if-exists "{testDatabase.name}" 2>/dev/null || true
```

**MySQL:**
```bash
mysql -u root -e "DROP DATABASE IF EXISTS \`{testDatabase.name}\`;" 2>/dev/null || true
```

**SQLite:**
```bash
rm -f "./{testDatabase.name}.sqlite" 2>/dev/null || true
```

**MongoDB:**
```bash
mongosh --eval "db.getSiblingDB('{testDatabase.name}').dropDatabase()" 2>/dev/null || true
```

> cleanup 실패 시 에러를 무시하고 진행한다 (`|| true`).
> 사용자에게 cleanup 결과(성공/실패)를 Output에서 보고한다.

cleanup 후 state.json의 `testDatabase` 필드를 `null`로 갱신한다.
