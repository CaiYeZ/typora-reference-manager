const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8')
const context = vm.createContext({ URL })
vm.runInContext(source.slice(source.indexOf('const DEFAULT_SETTINGS'), source.indexOf('const IGNORED_DIRS'))
  + source.slice(source.indexOf('// Rule matching'), source.indexOf('export default class'))
  + source.slice(source.indexOf('function wrapMarkdownTarget')), context)
const rules = vm.runInContext('DEFAULT_SETTINGS.linkNameRules', context)
const url = 'https://www.bilibili.com/video/BV1g6hR6pEmv/'
const match = (value, list = rules) => context.ruleLinkMarkdown(value, list)

test('built-in rule keeps destinations intact and extracts BV identifiers', () => {
  for (const value of [url, url.slice(0, -1), url + '?p=2#reply',
    'http://bilibili.com/video/BV1g6hR6pEmv#reply']) {
    assert.equal(match(value), `[BV1g6hR6pEmv](${value})`)
  }
  for (const value of [url.replace('bilibili.com', 'bilibili.com.evil.org'),
    url.replace('www.bilibili.com', 'evil.org'), url + 'extra', url + ' extra',
    'prefix ' + url, `[name](${url})`, '`' + url + '`', 'https://b23.tv/abc',
    url.replace('BV1g6hR6pEmv', 'av123'), '']) assert.equal(match(value), null, value)
})

test('ordered rules skip disabled, damaged, partial matches and empty results', () => {
  const rule = { name: 'test', enabled: true, pattern: '^https://(.+)$', template: 'first' }
  assert.equal(match(url, [rule, ...rules]), `[first](${url})`)
  for (const bad of [null, {}, { ...rule, enabled: false }, { ...rule, pattern: '(' },
    { ...rule, template: '' }, { ...rule, template: '$99' }, { ...rule, pattern: 'bilibili' },
    { ...rule, template: 'bad\nlabel' }]) {
    assert.equal(match(url, [bad, ...rules]), `[BV1g6hR6pEmv](${url})`)
  }
  assert.equal(match(url, []), null)
  assert.equal(match(url, {}), null)
})

test('templates support capture groups through 99 and escape literal Markdown', () => {
  const rule = { enabled: true, pattern: '^' + '(.)'.repeat(99) + '$', template: '$1-$10-$99' }
  const value = 'https://example.com/' + 'x'.repeat(78) + 'z'
  assert.equal(value.length, 99)
  assert.equal(match(value, [rule]), `[h-x-z](${value})`)
  rule.pattern = '^https://(.+)$'
  rule.template = '`*_[]<>!&~\\'
  assert.equal(match(url, [rule]), '[\\`\\*\\_\\[\\]\\<\\>\\!\\&\\~\\\\](' + url + ')')
})

test('source selection adapter protects syntax and uses an isolated undo origin', () => {
  let text = url, type = null, selections = [{}], focused = true, line = url
  const changes = []
  const cm = {
    hasFocus: () => focused, listSelections: () => selections,
    getCursor: side => ({ line: 0, ch: side === 'from' ? 0 : text.length }),
    getLine: () => line, getTokenAt: () => ({ type }), getSelection: () => text,
    replaceSelection: (...args) => changes.push(args),
  }
  context.window = { editor: { sourceView: { inSourceMode: true, cm } } }
  context.document = { activeElement: null }
  let selected = context.selectedUrlReplacement()
  selected.replace(match(selected.text))
  assert.deepEqual(changes[0], [`[BV1g6hR6pEmv](${url})`, 'end', 'reference-rule'])
  type = 'link'
  assert.ok(context.selectedUrlReplacement()) // GFM may highlight bare URLs as links.
  for (const token of ['comment', 'code', 'image', 'string', 'formatting-code']) {
    type = token
    assert.equal(context.selectedUrlReplacement(), null)
  }
  type = null; line = url + 'x'
  assert.equal(context.selectedUrlReplacement(), null)
  line = url + ' `code`'
  assert.equal(context.selectedUrlReplacement(), null)
  line = url; selections = [{}, {}]
  assert.equal(context.selectedUrlReplacement(), null)
  selections = [{}]; focused = false
  assert.equal(context.selectedUrlReplacement(), null)
})
