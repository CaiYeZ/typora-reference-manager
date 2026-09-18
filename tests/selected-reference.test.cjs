const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8')
const helpers = source.slice(source.indexOf('// Parse one complete'), source.indexOf('export default class'))
const context = vm.createContext({ path: path.win32 })
vm.runInContext(helpers, context)
const parse = text => JSON.parse(JSON.stringify(context.parseSelectedMarkdownLink(text)))
vm.runInContext(source.slice(source.indexOf('function normalizeReferenceHotkey'), source.indexOf('function fileIcon')), context)

test('favorite shortcut validation and collision detection', () => {
  assert.equal(context.normalizeReferenceHotkey('control+shift+r'), 'Ctrl+Shift+R')
  assert.equal(context.normalizeReferenceHotkey('alt+f5'), 'Alt+F5')
  assert.equal(context.normalizeReferenceHotkey('F8'), 'F8')
  for (const value of ['Ctrl', 'Ctrl+', 'Ctrl+K+R', 'R', 'Ctrl+invalid', 'Alt+F25']) {
    assert.equal(context.normalizeReferenceHotkey(value), null, value)
  }
  assert.equal(context.sameHotkey('Ctrl+Alt+I', 'Alt+Control+i'), true)
  assert.equal(context.sameHotkey('Ctrl+Shift+R', 'Alt+Ctrl+R'), false)
})

test('complete Markdown links preserve names, escaped punctuation and destinations', () => {
  for (const [input, name, target] of [
    ['[Watch Dog 2](https://store.steampowered.com/app/447040)', 'Watch Dog 2', 'https://store.steampowered.com/app/447040'],
    ['  [中文名称](../文档/说明.md)  ', '中文名称', '../文档/说明.md'],
    ['[nested [label]](https://example.com/a(b(c)))', 'nested [label]', 'https://example.com/a(b(c))'],
    [String.raw`[a\]b](https://example.com/a\(b\))`, 'a]b', 'https://example.com/a(b)'],
    ['[空格](<../my file.md> "title")', '空格', '../my file.md'],
    ["[name](target 'title')", 'name', 'target'],
    ['[name](target (title))', 'name', 'target'],
    ['[name](x"title")', 'name', 'x"title"'],
  ]) assert.deepEqual(parse(input), { name, target }, input)
})

test('ambiguous, incomplete and unsupported selections are rejected', () => {
  for (const input of ['', 'plain', '![image](x)', '[a][id]', '[a](x) [b](y)',
    'prefix [a](x)', '[a](x) suffix', '[a](x', '[a](a(b)', '[a](x "unterminated)',
    '[a](<unterminated)', '[a](x garbage)', '[](x)', '[a]()']) {
    assert.equal(parse(input), null, input)
  }
})

test('local targets resolve against the document; URI targets remain unchanged', () => {
  const target = value => context.selectedReferenceTarget(value, 'E:\\vault\\notes\\doc.md', 'E:\\vault')
  assert.equal(target('../images/my%20file.png'), 'E:\\vault\\images\\my file.png')
  assert.equal(target('./other.md#section'), 'E:\\vault\\notes\\other.md#section')
  assert.equal(target('#section'), 'E:\\vault\\notes\\doc.md#section')
  for (const value of ['https://example.com/a?q=b#c', 'mailto:a@example.com', 'steam://run/447040',
    '//example.com/a', 'C:\\files\\a.md']) assert.equal(target(value), value)
  assert.equal(context.selectedReferenceTarget('a.md', null, 'E:\\vault'), 'E:\\vault\\a.md')
  assert.equal(context.selectedReferenceTarget('a.md', null, null), null)
})

test('saved references immediately enter the index and generate reusable /fav links', () => {
  const indexContext = vm.createContext({ path: path.win32 })
  vm.runInContext(source.slice(source.indexOf('class ReferenceIndex'), source.indexOf('class BaseReferenceSuggest'))
    + source.slice(source.indexOf('function fileIcon')), indexContext)
  const Index = vm.runInContext('ReferenceIndex', indexContext)
  let refs = []
  const app = { vault: { path: 'E:\\vault' }, workspace: { activeFile: 'E:\\vault\\other\\doc.md' } }
  const index = new Index(app, { settings: { get: () => refs } })
  refs = [{ name: 'Watch Dog 2', target: 'https://store.steampowered.com/app/447040' },
    { name: '文件', target: context.selectedReferenceTarget('../images/p.png', 'E:\\vault\\notes\\doc.md', 'E:\\vault') }]
  index.refreshSaved()
  assert.equal(index.favoriteLabels.length, 2)
  assert.equal(index.favoriteToMarkdown(index.savedItems[0]), '[Watch Dog 2](https://store.steampowered.com/app/447040)')
  assert.equal(index.favoriteToMarkdown(index.savedItems[1]), '[文件](../images/p.png)')
  assert.equal(index.favoriteToMarkdown({ name: 'Steam', target: 'steam://run/447040' }), '[Steam](steam://run/447040)')
  assert.equal(index.fileToMarkdown({ name: 'guide.md', absolutePath: 'E:\\vault\\guide.md' }), '[guide](../guide.md)')
})

let chromium
try { ({ chromium } = require('playwright')) } catch (_) {}
test('real DOM selections and existing modal save/cancel flow', { skip: !chromium && 'Install playwright to run DOM tests' }, async () => {
  const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'chrome', headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<div id="write" contenteditable="true"></div><input id="palette"><div id="typora-source"></div>')
    await page.addScriptTag({ content: helpers })
    const result = await page.evaluate(() => {
      const root = document.getElementById('write')
      window.editor = { writingArea: root }
      const results = []
      const select = (html, selector, start = 0, end) => {
        root.innerHTML = html
        root.focus()
        const el = selector ? root.querySelector(selector) : root
        const range = document.createRange()
        if (end == null) range.selectNodeContents(el)
        else { range.setStart(el.firstChild, start); range.setEnd(el.firstChild, end) }
        window.getSelection().removeAllRanges()
        window.getSelection().addRange(range)
        return readSelectedReference()
      }
      results.push(select('<a href="../games.md">Watch Dog 2</a>', 'a', 2, 5))
      results.push(select('<span md-inline="link"><span>[</span><a href="https://example.com"><b>Watch</b> Dog 2</a><span>](url)</span></span>', 'a'))
      results.push(select('<a href="a">One</a> <a href="b">Two</a>'))
      results.push(select('extra <a href="a">One</a>'))
      results.push(select('<a href="a"><img src="x">One</a>'))
      results.push(select('<span md-inline="reflink"><a href="#">One</a></span>', 'a'))
      results.push(select('[Watch Dog 2](https://store.steampowered.com/app/447040)'))
      window.getSelection().collapse(root, 0)
      results.push(readSelectedReference())
      document.getElementById('palette').focus()
      results.push(readSelectedReference())
      window.editor.sourceView = { inSourceMode: true, cm: {
        hasFocus: () => true, getSelection: () => '[Source](./source.md)',
      } }
      results.push(readSelectedReference())
      return results
    })
    assert.deepEqual(result[0].reference, { name: 'Watch Dog 2', target: '../games.md' })
    assert.deepEqual(result[1].reference, { name: 'Watch Dog 2', target: 'https://example.com' })
    for (const i of [2, 3, 4, 5, 7, 8]) assert.equal(result[i].reference, null, `selection ${i}`)
    assert.equal(result[6].reference.name, 'Watch Dog 2')
    assert.equal(result[8].inEditor, false)
    assert.deepEqual(result[9].reference, { name: 'Source', target: './source.md' })

    await page.evaluate(() => {
      class Modal {
        constructor() {
          this.containerEl = document.createElement('div')
          this.body = document.createElement('div')
          this.footer = document.createElement('div')
          this.containerEl.append(this.body, this.footer)
          window.lastModal = this
        }
        setHeader() { return this }
        setBody(fn) { fn(this.body); return this }
        setFooter(fn) { fn(this.footer); return this }
        open() { document.body.append(this.containerEl) }
        close() { this.containerEl.remove() }
      }
      class SettingTab {
        constructor() { this.containerEl = document.createElement('div') }
        addSettingTitle() {}
        addSetting(fn) {
          const row = document.createElement('div')
          this.containerEl.append(row)
          const addControl = (tag, type, callback) => {
            const control = document.createElement(tag)
            if (type) control.type = type
            row.append(control)
            callback(control)
          }
          fn({
            addName: name => { row.dataset.name = name },
            addDescription: text => { row.dataset.description = text },
            addCheckbox: callback => addControl('input', 'checkbox', callback),
            addInput: (type, callback) => addControl('input', type, callback),
            addButton: callback => addControl('button', null, callback),
          })
        }
      }
      window[Symbol.for('typora-plugin-core@v2')] = {
        Plugin: class {}, PluginSettings: class {}, SettingTab, TextSuggest: class {}, Modal,
        path: { isAbsolute: () => false },
      }
    })
    // Separate script scope avoids redeclaring the helper functions above.
    await page.addScriptTag({ content: `{ ${source.replace('export default class', 'class')}; window.TestPlugin = ReferenceManagerPlugin; window.TestSettingTab = ReferenceManagerSettingTab; }` })
    const modalResult = await page.evaluate(() => {
      const plugin = new window.TestPlugin()
      let refs = []
      let refreshes = 0
      plugin.settings = { get: () => refs, set: (_, value) => { refs = value } }
      plugin.index = { refreshSaved: () => refreshes++ }
      plugin.settingTab = { render() {} }
      const before = document.getElementById('write').innerHTML
      plugin.openReferenceEditor(undefined, { name: 'Watch Dog 2', target: 'https://example.com' })
      const prefill = Array.from(lastModal.body.querySelectorAll('input'), el => el.value)
      lastModal.body.querySelector('input').value = 'Custom name'
      lastModal.containerEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))
      const imeCount = refs.length
      lastModal.footer.querySelector('.primary').click()
      plugin.openReferenceEditor(undefined, { name: 'Cancel', target: 'x' })
      lastModal.footer.querySelector('button').click()
      plugin.openReferenceEditor(0, { name: 'wrong', target: 'wrong' })
      const editing = lastModal.body.querySelector('input').value
      lastModal.containerEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      plugin.openReferenceEditor()
      const blank = Array.from(lastModal.body.querySelectorAll('input'), el => el.value)
      lastModal.footer.querySelector('button').click()
      return { refs, prefill, imeCount, editing, blank, refreshes, unchanged: before === document.getElementById('write').innerHTML }
    })
    assert.deepEqual(modalResult, {
      refs: [{ name: 'Custom name', target: 'https://example.com' }],
      prefill: ['Watch Dog 2', 'https://example.com'], imeCount: 0,
      editing: 'Custom name', blank: ['', ''], refreshes: 2, unchanged: true,
    })
    const captureResult = await page.evaluate(() => {
      const plugin = new window.TestPlugin()
      const root = document.getElementById('write')
      plugin.settings = { get: () => undefined }
      window.editor.sourceView = { inSourceMode: false }
      const handlers = {}
      const disposers = []
      const events = {}
      plugin.app = { workspace: { activeFile: 'doc.md', on: (name, fn) => {
        events[name] = fn
        return () => {}
      } }, vault: { path: 'vault' } }
      plugin.register = fn => disposers.push(fn)
      plugin.registerDomEvent = (el, event, fn, options) => {
        handlers[event] = fn
        el.addEventListener(event, fn, options)
        disposers.push(() => el.removeEventListener(event, fn, options))
      }
      plugin.registerSelectedReferenceCapture()
      const opened = []
      plugin.openReferenceEditor = (_, ref) => opened.push(ref || null)
      const selectLink = () => {
        root.innerHTML = '<a href="https://example.com">Example</a>'
        root.focus()
        const range = document.createRange()
        range.selectNodeContents(root.firstChild)
        window.getSelection().removeAllRanges()
        window.getSelection().addRange(range)
        handlers.selectionchange()
      }
      selectLink()
      plugin.openSelectedReferenceEditor() // Shortcut in the editor.
      selectLink()
      document.getElementById('palette').focus()
      handlers.selectionchange()
      plugin.openSelectedReferenceEditor() // Command palette steals focus.
      selectLink()
      document.getElementById('palette').focus()
      window.getSelection().collapse(root, 0)
      document.activeElement.blur()
      handlers.selectionchange()
      plugin.openSelectedReferenceEditor() // Palette closes before callback.
      selectLink()
      window.getSelection().collapse(root, 0)
      handlers.selectionchange()
      document.getElementById('palette').focus()
      plugin.openSelectedReferenceEditor() // Collapsing in the editor clears cache.
      selectLink()
      document.getElementById('palette').focus()
      events['file:will-open']()
      plugin.app.workspace.activeFile = 'other.md'
      events['file:open']()
      plugin.openSelectedReferenceEditor() // New document cannot use old selection.
      plugin.app.workspace.activeFile = undefined
      plugin.openSelectedReferenceEditor() // Untitled document with no snapshot.
      disposers.forEach(fn => fn())
      return opened
    })
    assert.deepEqual(captureResult, [
      { name: 'Example', target: 'https://example.com' },
      { name: 'Example', target: 'https://example.com' },
      { name: 'Example', target: 'https://example.com' }, null, null, null,
    ])
    const settingsResult = await page.evaluate(() => {
      const plugin = new window.TestPlugin()
      const values = { references: [] }
      const bindings = new Map()
      plugin.manifest = { id: 'local.reference-manager', name: 'Reference Manager' }
      plugin.app = { commands: { register: command => {
        bindings.set(command.hotkey, command)
        return () => bindings.delete(command.hotkey)
      } } }
      plugin.settings = {
        get: key => values[key],
        set: (key, value) => {
          values[key] = value
          if (key === 'addReferenceHotkey') plugin.registerAddReferenceCommand()
        },
      }
      plugin.registerAddReferenceCommand()
      const tab = new window.TestSettingTab(plugin)
      const findInput = name => tab.containerEl.querySelector(`[data-name="${name}"] input`)
      const change = (name, value) => {
        const input = findInput(name)
        input.value = value
        input.onchange()
      }
      const defaults = [findInput('选中链接自动填充').checked, findInput('新增常用引用快捷键').value]
      change('新增常用引用快捷键', 'Ctrl+Shift+R')
      const changed = [...bindings.keys()]
      const hint = tab.containerEl.querySelector('[data-name="暂无常用引用"]').dataset.description
      change('新增常用引用快捷键', 'Ctrl+Alt+I')
      const collision = findInput('新增常用引用快捷键').value
      change('手动刷新快捷键', 'Shift+Ctrl+R')
      const reverseCollision = findInput('手动刷新快捷键').value
      change('新增常用引用快捷键', 'Ctrl+')
      const invalid = findInput('新增常用引用快捷键').value
      change('新增常用引用快捷键', '')
      const reset = [...bindings.keys()]
      const toggle = findInput('选中链接自动填充')
      toggle.checked = false
      toggle.onchange()
      plugin.selectedReference = { file: 'old', reference: { name: 'Old', target: 'x' } }
      let blank = false
      plugin.openReferenceEditor = (...args) => { blank = args.length === 0 }
      plugin.openSelectedReferenceEditor()
      plugin.addReferenceCommandDispose()
      return { defaults, changed, hintUpdated: hint.includes('Ctrl+Shift+R'), collision,
        reverseCollision, invalid, reset, disabled: values.prefillSelectedLink === false,
        blank, cleared: plugin.selectedReference === null, unloaded: bindings.size === 0 }
    })
    assert.deepEqual(settingsResult, {
      defaults: [true, 'Alt+Ctrl+R'], changed: ['Ctrl+Shift+R'], hintUpdated: true,
      collision: 'Ctrl+Shift+R', reverseCollision: 'Alt+Ctrl+I', invalid: 'Ctrl+Shift+R',
      reset: ['Alt+Ctrl+R'], disabled: true, blank: true, cleared: true, unloaded: true,
    })
  } finally { await browser.close() }
})
