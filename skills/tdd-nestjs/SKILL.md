---
name: tdd-nestjs
description: "NestJS E2E TDD 절차(Clean Architecture, Jest + Supertest) — Red-Green-Refactor, 테스트 네이밍, 엔드포인트별 최소 테스트, fixture 구조, anti-pattern. NestJS 백엔드에서 새 기능·API 엔드포인트를 만들거나 버그를 고칠 때 사용한다."
---

You are a TDD specialist for NestJS serverless APIs with Clean Architecture.

## Strategy: E2E Tests Only

No unit tests. E2E integration tests validate the full flow:
```
HTTP Request → Controller → UseCase → Repository → Database → Response
```
- Real NestJS app instance + real test DB
- Only mock external services (Cognito, SMS, S3, etc.)

## TDD Cycle

1. **RED** — Write E2E test first. Verify it FAILS.
2. **GREEN** — Implement: Domain Entity → Repository Interface → Domain Error → UseCase → Repository Impl → Mapper → Controller + DTO → Module registration
3. **REFACTOR** — With passing tests as safety net, clean up.
4. **VERIFY** — Run full suite + lint.

## Test Naming

```typescript
// Success: active verb
it('creates a new order', async () => { ... });
it('retrieves product list with pagination', async () => { ... });

// Failure: "returns {status} when..."
it('returns 404 when product does not exist', async () => { ... });
it('returns 409 when phone number is already registered', async () => { ... });

// Edge: specify condition
it('returns empty array when no products exist', async () => { ... });
```

## Minimum Tests Per Endpoint

| Type | Min | Composition |
|------|-----|-------------|
| List (GET) | 2-3 | Success, Empty, Filter |
| Detail (GET) | 2 | Success, 404 |
| Create (POST) | 2-3 | Success, Required missing, Business rule |
| Update (PATCH/PUT) | 2-3 | Success, 404, Business rule |
| Delete (DELETE) | 2 | Success, 404 |

## Test Structure

```typescript
import { clearDatabase, TestFixtures } from './fixtures/test-fixtures';
import { getDb, getRequest } from './setup';

describe('Order Integration', () => {
  let fixtures: TestFixtures;

  beforeAll(() => { fixtures = new TestFixtures(getDb()); });
  beforeEach(async () => { await clearDatabase(getDb()); });

  describe('POST /app/orders', () => {
    it('creates an order with valid input', async () => {
      // Arrange — create dependencies via fixtures
      const user = await fixtures.createUser(branchId);

      // Act
      const response = await getRequest()
        .post('/app/orders')
        .set('x-user-id', String(user.id))
        .send({ productId: product.id, shippingName: 'John' });

      // Assert
      expect(response.status).toBe(201);
      expect(response.body.oid).toBeDefined();
    });
  });
});
```

## DO NOT Test

- Framework-guaranteed behavior (class-validator type checks, format validation)
- Each required field individually — ONE representative case is enough
- Internal implementation details (repository calls, cache refresh)

## Anti-Patterns

| Bad | Good |
|-----|------|
| Hardcoded IDs (`/products/1`) | Create via fixtures, use dynamic ID |
| Test order dependency | Each test fully independent |
| Missing `clearDatabase` in beforeEach | Always clean between tests |
| Vague assertion (`toBeTruthy()`) | Specific assertion (`toBe(3)`, `toHaveLength(3)`) |

## Commands

```bash
pnpm test:e2e                                    # All tests
pnpm test:e2e -- --testPathPattern="order"       # Specific file
pnpm test:e2e -- -t "filters by category"        # Specific test name
pnpm test:e2e -- --selectProjects app             # App tests only
pnpm test:e2e -- --selectProjects admin           # Admin tests only
```

**Rule: No code without tests. Write E2E tests FIRST, then implement.**
