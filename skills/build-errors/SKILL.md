---
name: build-errors
description: "TypeScript 빌드·타입 에러의 흔한 패턴과 최소 수정 예시(before/after) — 타입 추론 실패, null/undefined, 누락 프로퍼티, import·export, 타입 불일치, 제네릭 제약, async/await, module not found, enum·리터럴, index signature, overload, readonly, excess property. 빌드나 tsc가 실패해 에러를 고칠 때 사용한다."
---

# Build Error Patterns

**Pattern 1: Type Inference Failure**
```typescript
// ❌ ERROR: Parameter 'x' implicitly has an 'any' type
function add(x, y) {
  return x + y
}

// ✅ FIX: Add type annotations
function add(x: number, y: number): number {
  return x + y
}
```

**Pattern 2: Null/Undefined Errors**
```typescript
// ❌ ERROR: Object is possibly 'undefined'
const name = user.name.toUpperCase()

// ✅ FIX: Optional chaining
const name = user?.name?.toUpperCase()

// ✅ OR: Null check
const name = user && user.name ? user.name.toUpperCase() : ''
```

**Pattern 3: Missing Properties**
```typescript
// ❌ ERROR: Property 'age' does not exist on type 'User'
interface User {
  name: string
}
const user: User = { name: 'John', age: 30 }

// ✅ FIX: Add property to interface
interface User {
  name: string
  age?: number // Optional if not always present
}
```

**Pattern 4: Import Errors**
```typescript
// ❌ ERROR: Cannot find module '@/lib/utils'
import { formatDate } from '@/lib/utils'

// ✅ FIX 1: Check tsconfig paths are correct
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}

// ✅ FIX 2: Use relative import
import { formatDate } from '../lib/utils'

// ✅ FIX 3: Install missing package
npm install <missing-package>
```

**Pattern 5: Type Mismatch**
```typescript
// ❌ ERROR: Type 'string' is not assignable to type 'number'
const age: number = "30"

// ✅ FIX: Parse string to number
const age: number = parseInt("30", 10)

// ✅ OR: Change type
const age: string = "30"
```

**Pattern 6: Generic Constraints**
```typescript
// ❌ ERROR: Type 'T' is not assignable to type 'string'
function getLength<T>(item: T): number {
  return item.length
}

// ✅ FIX: Add constraint
function getLength<T extends { length: number }>(item: T): number {
  return item.length
}

// ✅ OR: More specific constraint
function getLength<T extends string | any[]>(item: T): number {
  return item.length
}
```

**Pattern 7: Async/Await Errors**
```typescript
// ❌ ERROR: 'await' expressions are only allowed within async functions
function fetchData() {
  const data = await fetch('/api/data')
}

// ✅ FIX: Add async keyword
async function fetchData() {
  const data = await fetch('/api/data')
}
```

**Pattern 8: Module Not Found**
```typescript
// ❌ ERROR: Cannot find module 'lodash' or its corresponding type declarations
import _ from 'lodash'

// ✅ FIX: Install dependencies
npm install lodash
npm install --save-dev @types/lodash

// ✅ CHECK: Verify package.json has dependency
{
  "dependencies": {
    "lodash": "^4.17.21"
  },
  "devDependencies": {
    "@types/lodash": "^4.17.0"
  }
}
```

**Pattern 9: Export Errors**
```typescript
// ❌ ERROR: Module has no exported member 'MyComponent'
import { MyComponent } from './components'

// ✅ FIX 1: Verify named export exists
// components.ts
export const MyComponent = () => { /* ... */ }

// ✅ FIX 2: Use default import if default export
import MyComponent from './components'

// ✅ FIX 3: Re-export from index.ts
export { MyComponent } from './MyComponent'
```

**Pattern 10: Enum/Literal Type Errors**
```typescript
// ❌ ERROR: Type 'string' is not assignable to type '"active" | "inactive"'
const status: 'active' | 'inactive' = getStatus() // returns string

// ✅ FIX 1: Type assertion
const status = getStatus() as 'active' | 'inactive'

// ✅ FIX 2: Type guard
const rawStatus = getStatus()
if (rawStatus === 'active' || rawStatus === 'inactive') {
  const status: 'active' | 'inactive' = rawStatus
}

// ✅ FIX 3: Fix function return type
function getStatus(): 'active' | 'inactive' {
  // ...
}
```

**Pattern 11: Index Signature Errors**
```typescript
// ❌ ERROR: Element implicitly has an 'any' type because expression of type 'string' can't be used to index type
const obj = { a: 1, b: 2 }
const key = 'a'
const value = obj[key] // ERROR

// ✅ FIX 1: Add index signature
const obj: { [key: string]: number } = { a: 1, b: 2 }

// ✅ FIX 2: Use Record type
const obj: Record<string, number> = { a: 1, b: 2 }

// ✅ FIX 3: Use keyof
const key: keyof typeof obj = 'a'
```

**Pattern 12: Function Overload Errors**
```typescript
// ❌ ERROR: This overload signature is not compatible with its implementation signature
function process(x: string): string
function process(x: number): number
function process(x: string | number) {
  return x
}

// ✅ FIX: Fix implementation signature return type
function process(x: string): string
function process(x: number): number
function process(x: string | number): string | number {
  return x
}
```

**Pattern 13: Readonly/Immutability Errors**
```typescript
// ❌ ERROR: Cannot assign to 'name' because it is a read-only property
interface User {
  readonly name: string
}
const user: User = { name: 'John' }
user.name = 'Jane' // ERROR

// ✅ FIX 1: Create new object
const updatedUser: User = { ...user, name: 'Jane' }

// ✅ FIX 2: Remove readonly if mutation is intended
interface User {
  name: string
}
```

**Pattern 14: Excess Property Checks**
```typescript
// ❌ ERROR: Object literal may only specify known properties
interface Config {
  host: string
  port: number
}
const config: Config = { host: 'localhost', port: 3000, debug: true } // ERROR

// ✅ FIX 1: Add property to interface
interface Config {
  host: string
  port: number
  debug?: boolean
}

// ✅ FIX 2: Use type assertion
const config = { host: 'localhost', port: 3000, debug: true } as Config

// ✅ FIX 3: Allow additional properties
interface Config {
  host: string
  port: number
  [key: string]: unknown
}
```
