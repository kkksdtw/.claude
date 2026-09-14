const assert = require('assert')
const { spawnSync } = require('child_process')
const path = require('path')

const hook = path.join(__dirname, 'no-comments.js')
const run = (tool_name, tool_input) =>
  spawnSync('node', [hook], { input: JSON.stringify({ tool_name, tool_input, cwd: '/nonexistent' }) }).status

assert.strictEqual(run('Write', { file_path: 'a.ts', content: 'const a = 1 // why' }), 2)
assert.strictEqual(run('Write', { file_path: 'a.ts', content: '/** doc */\nexport const a = 1' }), 2)
assert.strictEqual(run('Write', { file_path: 'a.tsx', content: '<div>{/* why */}</div>' }), 2)
assert.strictEqual(run('Edit', { file_path: 'a.py', old_string: 'x = 1', new_string: '# why\nx = 1' }), 2)
assert.strictEqual(run('Write', { file_path: 'a.py', content: 'def f():\n    """doc"""' }), 2)
assert.strictEqual(run('Write', { file_path: 'a.sql', content: 'select 1 -- why' }), 2)
assert.strictEqual(run('MultiEdit', { file_path: 'a.go', edits: [{ new_string: '// why' }] }), 2)
assert.strictEqual(run('Bash', { command: "cat > src/a.ts <<'EOF'\n// why\nEOF" }), 2)

assert.strictEqual(run('Write', { file_path: 'a.ts', content: 'const url = "https://x"\nconst glob = "src/**/*.ts"' }), 0)
assert.strictEqual(run('Write', { file_path: 'a.ts', content: '// @ts-expect-error\n// eslint-disable-next-line\nconst a = 1' }), 0)
assert.strictEqual(run('Write', { file_path: 'a.css', content: 'a { background: url(//cdn/x.png) }' }), 0)
assert.strictEqual(run('Write', { file_path: 'a.py', content: '#!/usr/bin/env python\nprint("Item #1")\nx = 1  # noqa' }), 0)
assert.strictEqual(run('Write', { file_path: 'a.sh', content: 'echo "${#arr[@]} $#"' }), 0)
assert.strictEqual(run('Write', { file_path: 'README.md', content: '# title' }), 0)
assert.strictEqual(run('Write', { file_path: 'ci.yml', content: 'uses: actions/checkout@abc # v4' }), 0)
assert.strictEqual(run('Bash', { command: 'npm test 2>&1 | tail' }), 0)
assert.strictEqual(run('Bash', { command: 'pnpm openapi-typescript spec.yaml > src/api.d.ts' }), 0)

console.log('ok')
