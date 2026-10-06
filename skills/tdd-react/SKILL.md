---
name: tdd-react
description: "React TDD 절차(React Testing Library + Vitest/Jest) — 사용자 관점 통합 테스트, 테스트 네이밍, MSW 모킹, 쿼리 우선순위, 컴포넌트 유형별 최소 테스트, anti-pattern. React 컴포넌트·hook·사용자 플로우를 만들거나 고칠 때 사용한다."
---

You are a TDD specialist for React applications using React Testing Library.

## Strategy: User-Centric Integration Tests

Test from the user's perspective, not implementation details.

| Test Type | Use | Tool |
|-----------|-----|------|
| Component integration | YES (primary) | React Testing Library |
| Hook test | YES (when complex) | renderHook |
| User flow (multi-page) | YES (critical paths) | RTL + Router |
| Unit test | NO | — |
| Visual/snapshot | NO | — |

## TDD Cycle

1. **RED** — Write test first. Verify it FAILS.
2. **GREEN** — Implement component/hook to pass.
3. **REFACTOR** — Clean up with passing tests as safety net.
4. **VERIFY** — Run full suite + lint.

## Test Naming

```typescript
// Rendering
it('renders product list with 3 items', () => { ... });
it('renders empty state when no products exist', () => { ... });

// Interaction
it('submits form with valid input', async () => { ... });
it('disables submit button while loading', () => { ... });

// Failure
it('shows error message when API call fails', async () => { ... });
it('shows validation error when email is invalid', async () => { ... });

// Navigation
it('navigates to detail page on card click', async () => { ... });
```

## Test Structure

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';

describe('LoginForm', () => {
  it('submits credentials and redirects on success', async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    // Act — interact as a real user
    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    // Assert
    await waitFor(() => {
      expect(screen.getByText('Welcome')).toBeInTheDocument();
    });
  });

  it('shows error message when credentials are invalid', async () => {
    server.use(
      http.post('/api/login', () => HttpResponse.json({ message: 'Invalid' }, { status: 401 }))
    );
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText('Email'), 'wrong@test.com');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid');
    });
  });
});
```

## API Mocking with MSW

```typescript
// mocks/handlers.ts
import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('/api/products', () =>
    HttpResponse.json([{ id: 1, name: 'Item A' }])
  ),
];

// mocks/server.ts
import { setupServer } from 'msw/node';
import { handlers } from './handlers';
export const server = setupServer(...handlers);

// Per-test override
server.use(
  http.get('/api/products', () => HttpResponse.json([], { status: 200 }))
);
```

## Query Priority (React Testing Library)

Use queries in this order (most accessible → least):

1. `getByRole` — buttons, links, headings, textboxes
2. `getByLabelText` — form fields
3. `getByPlaceholderText` — when no label exists
4. `getByText` — non-interactive content
5. `getByTestId` — last resort only

## Minimum Tests Per Component Type

| Component | Min | Composition |
|-----------|-----|-------------|
| Form | 3 | Submit success, Validation error, API error |
| List | 2-3 | With data, Empty state, Loading state |
| Detail page | 2 | Render data, 404/error state |
| Modal/Dialog | 2 | Open/close, Confirm action |
| Protected route | 2 | Authenticated, Redirects when unauthenticated |

## DO NOT Test

- Implementation details (state values, internal method calls, component re-render count)
- Styling/CSS classes
- Third-party library internals
- Every prop combination — test meaningful user scenarios

## Anti-Patterns

| Bad | Good |
|-----|------|
| `container.querySelector('.btn')` | `screen.getByRole('button')` |
| Test state directly (`wrapper.state()`) | Assert visible output |
| `fireEvent.change` for typing | `userEvent.type` (realistic) |
| Snapshot tests as primary strategy | Behavioral assertions |
| Mocking child components | Render the real tree |
| `act()` wrapping everything manually | Use `userEvent` + `waitFor` |

## Commands

```bash
pnpm test                                     # All tests
pnpm test -- --testPathPattern="LoginForm"    # Specific file
pnpm test -- -t "submits form"               # Specific test name
pnpm test -- --watch                          # Watch mode
pnpm test -- --coverage                       # Coverage report
```

**Rule: No component without tests. Write tests FIRST, then implement.**

## React/Next.js Performance Best Practices

When writing or modifying React/Next.js code, you MUST follow the Vercel React Best Practices.

Key priorities to always check:
1. **Eliminate waterfalls** — parallel fetches, defer await, Suspense boundaries
2. **Optimize bundle size** — avoid barrel imports, use dynamic imports, defer third-party scripts
3. **Server-side performance** — React.cache(), minimize client serialization, parallel fetching
4. **Re-render optimization** — derive state during render, functional setState, primitive deps
