const Core = window[Symbol.for('typora-plugin-core@v2')]
if (!Core) throw new Error('Typora Community Plugin core is not available')

const {
  fs,
  path,
  Plugin,
  PluginSettings,
  SettingTab,
  TextSuggest,
  Modal,
  openInputBox,
} = Core

function notify(message, type = 'success') {
  const old = document.getElementById('reference-manager-toast')
  old?.remove()

  const el = document.createElement('div')
  el.id = 'reference-manager-toast'
  el.textContent = message
  Object.assign(el.style, {
    position: 'fixed',
    top: '24px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '2147483647',
    padding: '9px 16px',
    borderRadius: '7px',
    color: '#fff',
    background: type === 'error' ? 'rgba(190, 45, 45, .96)' : 'rgba(45, 125, 70, .96)',
    font: '13px system-ui, sans-serif',
    boxShadow: '0 4px 14px rgba(0,0,0,.22)',
    pointerEvents: 'none',
    transition: 'opacity .2s ease',
  })
  document.documentElement.appendChild(el)

  setTimeout(() => {
    el.style.opacity = '0'
    setTimeout(() => el.remove(), 220)
  }, 1400)
}

const DEFAULT_SETTINGS = {
  references: [],
  scanFiles: true,
  refreshHotkey: 'Alt+Ctrl+I',
}

const IGNORED_DIRS = new Set([
  '.git',
  '.typora',
  'node_modules',
  '.idea',
  '.vscode',
])

export default class ReferenceManagerPlugin extends Plugin {
  async onload() {
    this.registerSettings(new PluginSettings(this.app, this.manifest, { version: 1 }))
    this.settings.setDefault(DEFAULT_SETTINGS)

    this.index = new ReferenceIndex(this.app, this)
    this.fileSuggest = new FileReferenceSuggest(this.index, this)
    this.favoriteSuggest = new FavoriteReferenceSuggest(this.index, this)
    this.settingTab = new ReferenceManagerSettingTab(this)

    this.register(this.app.workspace.activeEditor.suggestion.register(this.fileSuggest))
    this.register(this.app.workspace.activeEditor.suggestion.register(this.favoriteSuggest))
    this.registerSettingTab(this.settingTab)

    // Chinese/Japanese/Korean IMEs commit text through composition events.
    // Typora's normal editor edit event may not re-run suggestions at that point,
    // so explicitly re-check /ref and /fav after composition has been committed.
    const retriggerSuggestionAfterIme = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const selection = window.editor?.selection
          if (!selection?.getTextAround) return

          const around = selection.getTextAround()
          if (!around) return

          const [textBefore, textAfter, range] = around
          if (!range) return

          for (const suggest of [this.favoriteSuggest, this.fileSuggest]) {
            const result = suggest.findQuery(textBefore, textAfter, range)
            if (!result?.isMatched) continue

            suggest.show(range, result.query ?? '')
            return
          }
        })
      })
    }

    this.registerDomEvent(window, 'compositionend', retriggerSuggestionAfterIme, {
      capture: true,
    })

    // Reference Manager owns keyboard navigation only while its own popup
    // is actually visible. isUsing alone can remain true briefly after apply/hide.
    this.registerDomEvent(window, 'keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return

      const containers = Array.from(
        document.querySelectorAll('.auto-suggest-container')
      )

      const container = containers.find(el => {
        if (!el.querySelector('.reference-manager-suggestion')) return false

        const style = window.getComputedStyle(el)
        const rect = el.getBoundingClientRect()

        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && style.opacity !== '0'
          && rect.width > 0
          && rect.height > 0
      })

      // No visible Reference Manager popup: never intercept normal editor keys.
      if (!container) return

      const items = Array.from(container.querySelectorAll('li.typ-suggestion'))
        .filter(item => {
          const style = window.getComputedStyle(item)
          return style.display !== 'none' && style.visibility !== 'hidden'
        })

      if (!items.length) return

      const currentIndex = items.findIndex(item => item.classList.contains('active'))

      if (event.key === 'Enter') {
        const index = currentIndex >= 0 ? currentIndex : 0
        const active = items[index]
        const id = active?.getAttribute('data-content')
        if (!id) return

        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()

        window.editor?.autoComplete?.apply(id)

        // Force autocomplete state to close after applying a /ref or /fav item.
        // This prevents subsequent normal Enter presses from being captured.
        setTimeout(() => {
          window.editor?.autoComplete?.hide()
        }, 0)

        return
      }

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()

      let nextIndex
      if (event.key === 'ArrowDown') {
        nextIndex = currentIndex < 0
          ? 0
          : (currentIndex + 1) % items.length
      } else {
        nextIndex = currentIndex < 0
          ? items.length - 1
          : (currentIndex - 1 + items.length) % items.length
      }

      items.forEach((item, index) => {
        item.classList.toggle('active', index === nextIndex)
      })

      const active = items[nextIndex]
      const containerRect = container.getBoundingClientRect()
      const activeRect = active.getBoundingClientRect()

      if (activeRect.bottom > containerRect.bottom) {
        container.scrollTop += activeRect.bottom - containerRect.bottom
      } else if (activeRect.top < containerRect.top) {
        container.scrollTop -= containerRect.top - activeRect.top
      }

      if (event.key === 'ArrowDown' && nextIndex === 0) {
        container.scrollTop = 0
      } else if (event.key === 'ArrowUp' && nextIndex === items.length - 1) {
        container.scrollTop = container.scrollHeight
      }
    }, { capture: true })

    this.register(this.app.vault.on('mounted', async () => {
      await this.index.refresh()
      console.log(
        `[Reference Manager] vault mounted; index refreshed: ${this.index.fileItems.length} files`
      )
    }))
    this.register(this.settings.onChange('references', () => this.index.refreshSaved()))
    this.register(this.settings.onChange('scanFiles', () => this.index.refresh()))

    this.registerCommand({
      id: 'add-reference',
      title: '引用管理器：新增常用引用',
      scope: 'editor',
      hotkey: 'Alt+Ctrl+R',
      callback: () => this.openReferenceEditor(),
    })

    this.registerCommand({
      id: 'refresh-file-suggestions',
      title: '引用管理器：刷新文件索引',
      scope: 'editor',
      callback: async () => {
        await this.index.refresh()
        console.log(
          `[Reference Manager] manual index refresh: ${this.index.fileItems.length} files`
        )
        notify(`索引已刷新：${this.index.fileItems.length} 个文件`)
      },
    })

    // Configurable manual refresh shortcut.
    // Reads the current setting on every keydown, so changes take effect immediately.
    this.registerDomEvent(window, 'keydown', async event => {
      const configured = this.settings.get('refreshHotkey') || 'Alt+Ctrl+I'
      if (!hotkeyMatches(event, configured)) return

      event.preventDefault()
      event.stopPropagation()

      await this.index.refresh()
      console.log(
        `[Reference Manager] manual index refresh by hotkey (${configured}): ` +
        `${this.index.fileItems.length} files`
      )
      notify(`索引已刷新：${this.index.fileItems.length} 个文件`)
    }, { capture: true })

    // Rebuild the index whenever Typora loads this plugin.
    await this.index.refresh()
    console.log(
      `[Reference Manager] startup index refreshed: ${this.index.fileItems.length} files; ` +
      `${this.index.savedItems.length} favorites; triggers: /ref, /fav`
    )

    // Verify once more after Typora finishes mounting the workspace.
    setTimeout(async () => {
      try {
        await this.index.refresh()
        console.log(
          `[Reference Manager] startup index verified: ${this.index.fileItems.length} files`
        )
      } catch (error) {
        console.error('[Reference Manager] delayed startup refresh failed', error)
      }
    }, 1200)
  }

  openReferenceEditor(existingIndex) {
    const refsNow = this.settings.get('references') || []
    const existing = existingIndex == null ? undefined : refsNow[existingIndex]

    const modal = new Modal({ className: 'reference-manager-editor-modal' })
      .setHeader(existing ? '编辑常用引用' : '新增常用引用')

    modal.setBody(body => {
      body.innerHTML = ''

      const form = document.createElement('div')
      form.className = 'reference-manager-editor-form'

      const nameField = document.createElement('label')
      nameField.className = 'reference-manager-editor-field'

      const nameLabel = document.createElement('span')
      nameLabel.className = 'reference-manager-editor-label'
      nameLabel.textContent = '常用名称'

      const nameInput = document.createElement('input')
      nameInput.className = 'reference-manager-editor-input'
      nameInput.type = 'text'
      nameInput.placeholder = '例如：B站直播间'
      nameInput.value = existing?.name ?? ''

      nameField.append(nameLabel, nameInput)

      const targetField = document.createElement('label')
      targetField.className = 'reference-manager-editor-field'

      const targetLabel = document.createElement('span')
      targetLabel.className = 'reference-manager-editor-label'
      targetLabel.textContent = '地址'

      const targetInput = document.createElement('input')
      targetInput.className = 'reference-manager-editor-input'
      targetInput.type = 'text'
      targetInput.placeholder = 'https://... 或 images/example.png'
      targetInput.value = existing?.target ?? ''

      targetField.append(targetLabel, targetInput)

      const hint = document.createElement('div')
      hint.className = 'reference-manager-editor-hint'
      hint.textContent = '支持网址、绝对文件路径，以及相对于当前 Typora 工作目录的路径。'

      form.append(nameField, targetField, hint)
      body.append(form)

      modal._referenceManagerNameInput = nameInput
      modal._referenceManagerTargetInput = targetInput

      setTimeout(() => nameInput.focus(), 0)
    })

    modal.setFooter(footer => {
      const cancel = document.createElement('button')
      cancel.className = 'typ-button'
      cancel.textContent = '取消'
      cancel.onclick = () => modal.close()

      const save = document.createElement('button')
      save.className = 'typ-button primary'
      save.textContent = '保存'
      save.onclick = () => {
        const name = modal._referenceManagerNameInput?.value.trim()
        const target = modal._referenceManagerTargetInput?.value.trim()

        if (!name) {
          notify('请输入常用名称', 'error')
          modal._referenceManagerNameInput?.focus()
          return
        }

        if (!target) {
          notify('请输入地址', 'error')
          modal._referenceManagerTargetInput?.focus()
          return
        }

        const refs = [...(this.settings.get('references') || [])]
        if (existingIndex == null) refs.push({ name, target })
        else refs[existingIndex] = { name, target }

        this.settings.set('references', refs)
        this.index.refreshSaved()
        this.settingTab.render()

        console.log(`[Reference Manager] saved favorite: ${name} -> ${target}`)
        notify(existingIndex == null ? '已保存常用引用' : '已更新常用引用')
        modal.close()
      }

      footer.append(cancel, save)
    })

    modal.containerEl.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        modal.footer?.querySelector('.typ-button.primary')?.click()
      }
    })

    // Confirmation-only editor:
    // clicking outside or pressing Escape must not close the modal.
    // Only the explicit Cancel / Save buttons may close it.
    modal.containerEl.addEventListener('click', event => {
      if (event.target !== modal.containerEl) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }, true)

    modal.containerEl.addEventListener('keyup', event => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }, true)

    modal.open()
  }

  deleteReference(index) {
    const refs = [...(this.settings.get('references') || [])]
    const removed = refs[index]
    if (!removed) return
    if (!window.confirm(`删除引用“${removed.name}”？`)) return

    refs.splice(index, 1)
    this.settings.set('references', refs)
    this.settingTab.render()
    notify('已删除引用')
  }
}

class ReferenceManagerSettingTab extends SettingTab {
  constructor(plugin) {
    super()
    this.plugin = plugin
    this.render()
  }

  get name() {
    return 'Reference Manager'
  }

  onshow() {
    this.render()
  }

  render() {
    const plugin = this.plugin
    this.containerEl.replaceChildren()

    this.addSettingTitle('引用管理器')

    this.addSetting(setting => {
      setting.addName('文件引用')
      setting.addDescription('输入 /ref 后继续输入文件名或路径，选择候选项后插入标准 Markdown 文件链接。')
    })

    this.addSetting(setting => {
      setting.addName('常用引用')
      setting.addDescription('输入 /fav 后继续输入保存的名称，选择后插入保存的网址或文件链接。')
    })

    this.addSetting(setting => {
      setting.addName('自动扫描工作目录文件')
      setting.addDescription('图片、PDF、Markdown、字幕、压缩包等普通文件都会进入 /ref 建议；图片只作为链接，不会嵌入正文。')
      setting.addCheckbox(checkbox => {
        checkbox.checked = plugin.settings.get('scanFiles')
        checkbox.onchange = async () => {
          plugin.settings.set('scanFiles', checkbox.checked)
          await plugin.index.refresh()
        }
      })
    })

    this.addSetting(setting => {
      setting.addName('最大候选数量')
      setting.addInput('number', input => {
        input.min = '10'
        input.max = '200'
        input.value = String(plugin.settings.get('maxSuggestions'))
        input.onchange = () => {
          const value = Math.max(10, Math.min(200, Number(input.value) || 50))
          plugin.settings.set('maxSuggestions', value)
          input.value = String(value)
        }
      })
    })

    this.addSetting(setting => {
      setting.addName('手动刷新快捷键')
      setting.addDescription(
        '用于手动重新扫描文件索引。格式示例：Alt+Ctrl+I、Ctrl+Shift+R。修改后立即生效。'
      )
      setting.addInput('text', input => {
        input.value = plugin.settings.get('refreshHotkey') || 'Alt+Ctrl+I'
        input.placeholder = 'Alt+Ctrl+I'

        input.onchange = () => {
          const normalized = normalizeHotkey(input.value)
          plugin.settings.set('refreshHotkey', normalized || 'Alt+Ctrl+I')
          input.value = plugin.settings.get('refreshHotkey')
          notify(`刷新快捷键：${input.value}`)
        }
      })
    })

    this.addSetting(setting => {
      setting.addName('管理常用引用')
      setting.addDescription('保存经常使用的网址或文件，并保留自定义名称。')
      setting.addButton(button => {
        button.textContent = '＋ 新增'
        button.onclick = () => plugin.openReferenceEditor()
      })
      setting.addButton(button => {
        button.textContent = '刷新文件索引'
        button.onclick = async () => {
          await plugin.index.refresh()
          notify(`已索引 ${plugin.index.fileItems.length} 个文件`)
        }
      })
    })

    const refs = plugin.settings.get('references') || []
    if (!refs.length) {
      this.addSetting(setting => {
        setting.addName('暂无常用引用')
        setting.addDescription('点击上方“新增”，或者在编辑器中按 Alt+Ctrl+R。')
      })
      return
    }

    refs.forEach((ref, index) => {
      this.addSetting(setting => {
        setting.addName(ref.name)
        setting.addDescription(ref.target)
        setting.addButton(button => {
          button.textContent = '编辑'
          button.onclick = () => plugin.openReferenceEditor(index)
        })
        setting.addButton(button => {
          button.textContent = '删除'
          button.onclick = () => plugin.deleteReference(index)
        })
      })
    })
  }
}

class ReferenceIndex {
  constructor(app, plugin) {
    this.app = app
    this.plugin = plugin
    this.fileItems = []
    this.savedItems = []

    this.fileLabels = []
    this.favoriteLabels = []
    this.fileByLabel = new Map()
    this.favoriteByLabel = new Map()
  }

  async refresh() {
    this.refreshSaved(false)

    if (this.plugin.settings.get('scanFiles')) {
      this.fileItems = await this.scanVaultFiles()
    } else {
      this.fileItems = []
    }

    this.rebuild()
  }

  refreshSaved(rebuild = true) {
    this.savedItems = (this.plugin.settings.get('references') || []).map(ref => ({
      kind: 'saved',
      name: ref.name,
      target: ref.target,
    }))

    if (rebuild) this.rebuild()
  }

  rebuild() {
    this.fileByLabel.clear()
    this.favoriteByLabel.clear()
    this.fileLabels = []
    this.favoriteLabels = []

    const addUnique = (map, array, label, item) => {
      let unique = label
      let n = 2
      while (map.has(unique)) unique = `${label} (${n++})`
      map.set(unique, item)
      array.push(unique)
    }

    for (const item of this.fileItems) {
      addUnique(
        this.fileByLabel,
        this.fileLabels,
        `${fileIcon(item.name)} ${item.name}  —  ${item.target}`,
        item,
      )
    }

    for (const item of this.savedItems) {
      addUnique(
        this.favoriteByLabel,
        this.favoriteLabels,
        `★ ${item.name}  —  ${item.target}`,
        item,
      )
    }
  }

  async scanVaultFiles() {
    const root = this.app.vault.path
    if (!root) return []

    const results = []

    const walk = async dir => {
      let names
      try {
        names = await fs.list(dir)
      } catch {
        return
      }

      for (const name of names) {
        if (IGNORED_DIRS.has(name)) continue

        const absolute = path.join(dir, name)
        let isDir = false

        try {
          isDir = await fs.isDirectory(absolute)
        } catch {
          continue
        }

        if (isDir) {
          await walk(absolute)
          continue
        }

        const relative = path.relative(root, absolute).replace(/\\/g, '/')
        results.push({
          kind: 'file',
          name,
          target: relative,
          absolutePath: absolute,
        })
      }
    }

    await walk(root)
    return results.sort((a, b) => a.target.localeCompare(b.target, 'zh-CN'))
  }

  fileToMarkdown(item) {
    const target = this.toLinkTarget(item.absolutePath ?? item.target)

    // Use the filename without its final extension as the Markdown link text.
    // The actual link target keeps the complete filename and extension.
    const ext = path.extname(item.name)
    const displayName = ext
      ? item.name.slice(0, -ext.length)
      : item.name

    return `[${escapeMarkdownLabel(displayName)}](${wrapMarkdownTarget(target)})`
  }

  favoriteToMarkdown(item) {
    const target = this.savedTargetToLink(item.target)
    return `[${escapeMarkdownLabel(item.name)}](${wrapMarkdownTarget(target)})`
  }

  savedTargetToLink(target) {
    if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(target) || target.startsWith('mailto:')) {
      return target
    }

    if (path.isAbsolute(target)) {
      return this.toLinkTarget(target)
    }

    const absolute = path.join(this.app.vault.path, target)
    return this.toLinkTarget(absolute)
  }

  toLinkTarget(absolutePath) {
    const currentFile = this.app.workspace.activeFile
    const currentDir = currentFile ? path.dirname(currentFile) : this.app.vault.path

    let relative = path.relative(currentDir, absolutePath)

    if (path.isAbsolute(relative) || /^[A-Za-z]:[\\/]/.test(relative)) {
      return 'file:///' + absolutePath.replace(/\\/g, '/')
    }

    relative = relative.replace(/\\/g, '/')
    if (!relative.startsWith('.') && !relative.startsWith('/')) relative = './' + relative

    return relative || './' + path.basename(absolutePath)
  }
}

class BaseReferenceSuggest extends TextSuggest {
  constructor(index, plugin) {
    super()
    this.index = index
    this.plugin = plugin
  }

  getSuggestions(query) {
    const cleanQuery = query.trimStart()
    return super.getSuggestions(cleanQuery)
  }

  renderSuggestion(suggest) {
    return `<span class="reference-manager-suggestion">${escapeHtml(suggest)}</span>`
  }
}

class FileReferenceSuggest extends BaseReferenceSuggest {
  constructor(index, plugin) {
    super(index, plugin)
    this.triggerText = '/ref'
  }

  get suggestions() {
    return this.index.fileLabels
  }

  set suggestions(_) {}

  findQuery(textBefore) {
    // Compatible with Chinese IME punctuation/full-width input:
    // /ref   ／ref   、ref   ／ｒｅｆ
    const matched = textBefore.match(/[\/／、](?:ref|ｒｅｆ)([^\n]*)$/i)
    return {
      isMatched: !!matched,
      query: matched?.[1] ?? '',
    }
  }

  getSuggestionById(id) {
    return id
  }

  beforeApply(suggest) {
    const item = this.index.fileByLabel.get(suggest)
    return item ? this.index.fileToMarkdown(item) : suggest
  }
}

class FavoriteReferenceSuggest extends BaseReferenceSuggest {
  constructor(index, plugin) {
    super(index, plugin)
    this.triggerText = '/fav'
  }

  get suggestions() {
    return this.index.favoriteLabels
  }

  set suggestions(_) {}

  findQuery(textBefore) {
    // Compatible with Chinese IME punctuation/full-width input:
    // /fav   ／fav   、fav   ／ｆａｖ
    const matched = textBefore.match(/[\/／、](?:fav|ｆａｖ)([^\n]*)$/i)
    return {
      isMatched: !!matched,
      query: matched?.[1] ?? '',
    }
  }

  getSuggestionById(id) {
    return id
  }

  beforeApply(suggest) {
    const item = this.index.favoriteByLabel.get(suggest)
    return item ? this.index.favoriteToMarkdown(item) : suggest
  }
}

function normalizeHotkey(value) {
  const parts = String(value || '')
    .split('+')
    .map(part => part.trim())
    .filter(Boolean)

  if (!parts.length) return ''

  const modifiers = []
  let key = ''

  for (const raw of parts) {
    const lower = raw.toLowerCase()

    if (['ctrl', 'control'].includes(lower)) {
      if (!modifiers.includes('Ctrl')) modifiers.push('Ctrl')
      continue
    }

    if (['alt', 'option'].includes(lower)) {
      if (!modifiers.includes('Alt')) modifiers.push('Alt')
      continue
    }

    if (['shift'].includes(lower)) {
      if (!modifiers.includes('Shift')) modifiers.push('Shift')
      continue
    }

    if (['meta', 'cmd', 'command', 'win', 'windows'].includes(lower)) {
      if (!modifiers.includes('Meta')) modifiers.push('Meta')
      continue
    }

    key = raw.length === 1 ? raw.toUpperCase() : raw
  }

  return [...modifiers, key].filter(Boolean).join('+')
}

function hotkeyMatches(event, hotkey) {
  const normalized = normalizeHotkey(hotkey)
  if (!normalized) return false

  const parts = normalized.split('+')
  const key = parts[parts.length - 1]
  const modifiers = new Set(parts.slice(0, -1))

  if (event.ctrlKey !== modifiers.has('Ctrl')) return false
  if (event.altKey !== modifiers.has('Alt')) return false
  if (event.shiftKey !== modifiers.has('Shift')) return false
  if (event.metaKey !== modifiers.has('Meta')) return false

  const eventKey = event.key.length === 1 ? event.key.toUpperCase() : event.key
  return eventKey === key
}

function fileIcon(name) {
  const ext = String(name).toLowerCase().split('.').pop()

  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'].includes(ext)) return '🖼'
  if (['md', 'markdown', 'txt', 'rtf'].includes(ext)) return '📄'
  if (['pdf'].includes(ext)) return 'PDF'
  if (['ass', 'srt', 'vtt', 'ssa'].includes(ext)) return 'CC'
  if (['zip', '7z', 'rar', 'tar', 'gz'].includes(ext)) return '📦'
  return '📎'
}

function escapeMarkdownLabel(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
}

function wrapMarkdownTarget(target) {
  if (/\s|[()<>]/.test(target)) {
    return `<${String(target).replace(/>/g, '%3E')}>`
  }
  return target
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
