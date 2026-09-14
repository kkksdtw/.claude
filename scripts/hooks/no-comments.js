#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const SOURCE = /\.(c|cc|cpp|h|hpp|cs|java|kt|kts|scala|swift|dart|go|rs|php|js|jsx|mjs|cjs|ts|tsx|mts|cts|vue|svelte|css|scss|less|py|rb|sh|bash|zsh|sql)$/i
const DIRECTIVE = /^#!|eslint-|prettier-ignore|biome-ignore|@ts-|istanbul ignore|[cv]8 ignore|webpack[A-Z]|@vite-ignore|noqa|type:\s*ignore|pyright:|mypy:|pylint:|nolint|^\/\/go:|^\/\/ \+build|shellcheck |<reference|@type\s|@jsx|@(vitest|jest)-environment|coding[:=]|frozen_string_literal|rubocop:|swiftlint:|NOSONAR|#(end)?region|@license|@preserve/

function pattern(file) {
  if (/\.(py|rb|sh|bash|zsh)$/i.test(file)) return /(^|\s)#(\s|$)|^("""|''')/
  if (/\.sql$/i.test(file)) return /(^|\s)--(\s|$)|(^|\s)\/\*/
  return /(^|[\s{])\/[/*]|<!--/
}

function comments(file, text, before) {
  const existing = new Set(before.split('\n').map(line => line.trim()))
  const regex = pattern(file)
  return text.split('\n').map(line => line.trim())
    .filter(line => line && regex.test(line) && !DIRECTIVE.test(line) && !existing.has(line))
}

function targets(command) {
  return [...command.matchAll(/(?:>>?|\btee(?:\s+-a)?)\s*["']?([^\s"'|;&<>()]+)/g)].map(match => match[1])
}

let raw = ''
process.stdin.on('data', chunk => raw += chunk).on('end', () => {
  const { tool_name, tool_input: input = {}, cwd = process.cwd() } = JSON.parse(raw || '{}')
  const writes = tool_name === 'Bash'
    ? targets(input.command || '').map(file => [file, input.command])
    : [[input.file_path, input.content ?? input.new_string ?? (input.edits || []).map(edit => edit.new_string).join('\n')]]
  const found = writes.filter(([file]) => file && SOURCE.test(file)).flatMap(([file, text]) => {
    const full = path.resolve(cwd, file)
    const before = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : ''
    return comments(file, text || '', before).map(line => `  ${file}: ${line}`)
  })
  if (!found.length) return
  console.error([
    '[no-comments] 소스 코드에 주석을 쓰지 않는다 (docstring·JSDoc·TODO·ponytail: 포함). 아래 주석을 빼고 다시 작성하라 — 의도는 이름·구조·테스트로 드러낸다.',
    ...found,
    '허용: 기존 주석 유지, 도구 지시문(eslint-disable, @ts-expect-error, noqa, shebang 등).',
  ].join('\n'))
  process.exit(2)
})
