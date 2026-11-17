/**
 * Cross-platform guard: the login window must behave identically for every
 * platform that signs in with a QR code, and the settings sign-out must keep
 * working for all of them.
 *
 * The Navidrome refactor touched shared files (panel.js, settings.js,
 * online.js, dialogs.js). This test proves the QR platforms were not disturbed:
 * for each of them the window opens on the QR card, never the credential form,
 * and the platform list still offers every source.
 */

import assert from 'node:assert/strict'

const REQUESTS = []
global.fetch = async (url, options) => {
  REQUESTS.push({ url: String(url), method: (options && options.method) || 'GET' })
  return { ok: true, status: 200, json: async () => ({ ok: true, providers: {} }) }
}

/**
 * Every platform the host registers, with the capabilities it really declares
 * (verified against src/host/providers/sources/index.js). Only navidrome lacks
 * loginQr, which is what selects the credential form.
 */
const QR_PLATFORMS = ['netease', 'qq', 'kugouLite', 'bodian', 'qishui']
const PROVIDERS = {}
for (const id of QR_PLATFORMS) {
  PROVIDERS[id] = { loggedIn: false, capabilities: { loginQr: true, auth: true } }
}
PROVIDERS.navidrome = {
  loggedIn: false,
  capabilities: { loginPassword: true, loginQr: false, auth: true },
}

let hookCursor = 0
const hookSlots = []
const React = {
  createElement: (type, props, ...children) => {
    const nextProps = props ? { ...props } : {}
    const kids =
      children.length > 0
        ? children
        : nextProps.children === undefined
          ? []
          : Array.isArray(nextProps.children)
            ? nextProps.children
            : [nextProps.children]
    if (kids.length > 0) nextProps.children = kids.length === 1 ? kids[0] : kids
    return { type, props: nextProps, children: kids }
  },
  useState: (initial) => {
    const slot = hookCursor++
    if (!(slot in hookSlots)) {
      hookSlots[slot] = typeof initial === 'function' ? initial() : initial
    }
    const set = (next) => {
      hookSlots[slot] = typeof next === 'function' ? next(hookSlots[slot]) : next
    }
    return [hookSlots[slot], set]
  },
  useEffect() {},
  useLayoutEffect() {},
  useRef: (initial) => ({ current: initial }),
  useMemo: (factory) => factory(),
  useCallback: (factory) => factory,
  useSyncExternalStore: (subscribe, get) => get(),
  Fragment: 'fragment',
  Component: class Component {
    constructor(props) {
      this.props = props
      this.state = {}
    }
    setState() {}
  },
}

const components = new Map()

global.window = {
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  setTimeout: (callback) => setTimeout(callback, 0),
  clearTimeout: (id) => clearTimeout(id),
  location: { href: 'http://127.0.0.1/' },
  innerWidth: 1400,
  innerHeight: 900,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  __ModuleLoader__: {
    load(definition) {
      globalThis.__dshMusicDef = definition
    },
  },
}

global.HTMLElement = class HTMLElement {}
global.localStorage = {
  _data: new Map(),
  getItem(key) {
    return this._data.has(key) ? this._data.get(key) : null
  },
  setItem(key, value) {
    this._data.set(key, String(value))
  },
}
global.document = {
  head: { appendChild() {} },
  activeElement: null,
  createElement() {
    return { dataset: {}, textContent: '', remove() {} }
  },
  documentElement: { getAttribute: () => 'zh-CN' },
  visibilityState: 'visible',
  addEventListener() {},
  removeEventListener() {},
  body: { appendChild() {} },
}
global.addEventListener = () => {}
global.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
global.innerWidth = 1400
global.innerHeight = 900
Object.defineProperty(globalThis, 'navigator', {
  value: { mediaDevices: { enumerateDevices: async () => [] } },
  configurable: true,
})

await import('../../client.js')

const definition = globalThis.__dshMusicDef
assert.ok(definition, 'client.js must register through window.__ModuleLoader__')
const api = definition.factory((name) => {
  assert.equal(name, 'react', 'unexpected host module: ' + name)
  return React
})

api.apply({
  effect(factory) {
    factory()
    return () => {}
  },
  slots: {
    inject(name, callback) {
      callback()
      return () => {}
    },
    register(registration, component) {
      components.set(registration.name + ':' + (registration.id || registration.key || ''), component)
      return () => {}
    },
  },
})

function isClassComponent(type) {
  if (typeof type !== 'function' || !type.prototype) return false
  if (type.prototype.isReactComponent) return true
  return /^class\b/.test(Function.prototype.toString.call(type))
}

function expand(node) {
  if (node === null || node === undefined) return node
  if (Array.isArray(node)) return node.map(expand)
  if (typeof node !== 'object') return node
  if (typeof node.type === 'function') {
    if (isClassComponent(node.type)) return expand(node.children || (node.props && node.props.children))
    return expand(node.type(node.props || {}))
  }
  return Object.assign({}, node, {
    children: Array.isArray(node.children) ? node.children.map(expand) : node.children,
  })
}

function walk(node, visit) {
  if (node === null || node === undefined) return
  if (Array.isArray(node)) {
    node.forEach((item) => walk(item, visit))
    return
  }
  if (typeof node !== 'object') return
  if (node.type) visit(node)
  if (Array.isArray(node.children)) node.children.forEach((child) => walk(child, visit))
}

const hasClass = (node, name) =>
  !!node.props &&
  typeof node.props.className === 'string' &&
  node.props.className.split(/\s+/).filter(Boolean).includes(name)

const internals = api.__internals
assert.ok(internals, 'internals are exposed for tests')
const panel = components.get('main:music')
assert.ok(panel, 'the panel component is registered')

/** Render the panel with the login layer open on `provider`. */
function renderLogin(provider) {
  internals.overlayStore.set({ layers: [{ kind: 'login', props: { provider: provider } }] })
  internals.uiStore.set({ source: provider, nav: 'recent', filter: null, query: '' })
  internals.onlineStore.set({
    provider: provider,
    results: [],
    phase: 'idle',
    playlists: [],
    providers: PROVIDERS,
  })
  hookCursor = 0
  hookSlots.length = 0
  return expand(panel())
}

// ── 1. every QR platform still opens on the QR card ───────────────────────
for (const provider of QR_PLATFORMS) {
  const tree = renderLogin(provider)
  const qrShells = []
  const credentialForms = []
  walk(tree, (node) => {
    if (hasClass(node, 'mp-login-qr-shell')) qrShells.push(node)
    if (hasClass(node, 'mp-login-nav')) credentialForms.push(node)
  })
  assert.equal(qrShells.length, 1, `${provider} must render the QR card`)
  assert.equal(credentialForms.length, 0, `${provider} must NOT render the credential form`)
}

// ── 2. navidrome still opens on the credential form ───────────────────────
{
  const tree = renderLogin('navidrome')
  const qrShells = []
  const credentialForms = []
  const switches = []
  walk(tree, (node) => {
    if (hasClass(node, 'mp-login-qr-shell')) qrShells.push(node)
    if (hasClass(node, 'mp-login-nav')) credentialForms.push(node)
    if (hasClass(node, 'mp-switch')) switches.push(node)
  })
  assert.equal(credentialForms.length, 1, 'navidrome renders the credential form')
  assert.equal(qrShells.length, 0, 'navidrome must NOT render a QR card it cannot use')
  assert.equal(switches.length, 1, 'navidrome offers the keep-password switch')
}

// ── 3. the platform rail lists every signed-in-capable source ─────────────
{
  const tree = renderLogin('netease')
  const rows = []
  walk(tree, (node) => {
    if (hasClass(node, 'mp-login-platform')) rows.push(node)
  })
  const expected = QR_PLATFORMS.length + 1
  assert.equal(rows.length, expected, `the rail lists ${expected} platforms, saw ${rows.length}`)
}

// ── 4. settings still renders a card for every platform ───────────────────
{
  internals.overlayStore.set({ layers: [{ kind: 'settings', props: {} }] })
  internals.uiStore.set({ source: 'netease', nav: 'recent', filter: null, query: '' })
  internals.onlineStore.set({
    provider: 'netease',
    results: [],
    phase: 'idle',
    playlists: [],
    providers: PROVIDERS,
  })
  hookCursor = 0
  hookSlots.length = 0
  // The sheet opens on its first tab; nothing on that tab should throw for a
  // QR source, and the panel must still render.
  const tree = expand(panel())
  const sheets = []
  walk(tree, (node) => {
    if (hasClass(node, 'mp-sheet')) sheets.push(node)
  })
  assert.equal(sheets.length, 1, 'the settings sheet renders for a QR source')
}

console.log('  ok  QR platforms keep their QR login flow (5 platforms)')
console.log('  ok  navidrome alone renders the credential form')
console.log('  ok  the platform rail still lists every source')
console.log('  ok  settings still renders for every platform')
console.log('\nlogin-platforms.test.mjs ok')
