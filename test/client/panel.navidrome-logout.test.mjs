/**
 * Regression guard: the settings online tab's Navidrome sign-out button.
 *
 * A shipped bug made it dead: `useNavidromeForm().reset()` called a
 * `setKeepPassword` binding that was never declared, so the click handler threw
 * a ReferenceError before `logoutProvider()` ran. The panel caught nothing, the
 * button simply did nothing, and no test noticed because nothing clicked it.
 *
 * This test renders the settings sheet straight onto the online tab and clicks
 * the button, asserting that the POST actually leaves the client.
 */

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUESTS = []
global.fetch = async (url, options) => {
  REQUESTS.push({
    url: String(url),
    method: (options && options.method) || 'GET',
    body: options && typeof options.body === 'string' ? options.body : null,
  })
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, providers: {} }),
  }
}

/**
 * Stateful-enough `useState`: the sheet only needs its initial tab to be
 * `online`, but the credential form has to hold typed values and a flipped
 * switch across re-renders, so slots persist in a per-hook-order table.
 */
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
      const value = typeof initial === 'function' ? initial() : initial
      // Open the settings sheet on the online tab.
      hookSlots[slot] = value === 'appearance' ? 'online' : value
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

const internals = api.__internals
assert.ok(internals, 'internals are exposed for tests')

internals.overlayStore.set({ layers: [{ kind: 'settings', props: {} }] })
internals.uiStore.set({ source: 'navidrome', nav: 'recent', filter: null, query: '' })
internals.onlineStore.set({
  provider: 'navidrome',
  results: [],
  phase: 'idle',
  playlists: [],
  providers: {
    navidrome: {
      loggedIn: true,
      nickname: 'alice',
      server: 'https://nd.example.com',
      capabilities: { loginPassword: true, loginQr: false },
    },
  },
})

const panel = components.get('main:music')
assert.ok(panel, 'the panel component is registered')

/** Render the panel from a clean hook frame. */
function render() {
  hookCursor = 0
  return expand(panel())
}

const tree = render()
const buttons = []
walk(tree, (node) => {
  if (node.props && typeof node.props.className === 'string' && node.props.className.includes('mp-iconbtn')) {
    buttons.push(node)
  }
})

const navLogout = buttons.filter((node) => node.props.title === '退出' || node.props.title === 'Sign out')
assert.equal(navLogout.length, 1, 'the navidrome card renders exactly one sign-out button')

const navCard = []
walk(tree, (node) => {
  if (node.props && typeof node.props.className === 'string' && node.props.className.includes('is-navidrome')) {
    navCard.push(node)
  }
})
assert.equal(navCard.length, 1, 'the navidrome card renders')
assert.ok(
  String(navCard[0].props.className).includes('is-logged'),
  'the card knows the account is signed in',
)

// Click it: a dead handler throws here rather than silently doing nothing.
REQUESTS.length = 0
navLogout[0].props.onClick()
await new Promise((resolve) => setTimeout(resolve, 80))

const posted = REQUESTS.filter((entry) => entry.url.includes('online/logout'))
assert.equal(posted.length, 1, 'clicking sign out must POST /online/logout')
assert.equal(posted[0].method, 'POST', 'the sign-out call is a POST')
const refreshed = REQUESTS.filter((entry) => entry.url.includes('online/providers'))
assert.equal(refreshed.length, 1, 'the provider list is reloaded after signing out')

console.log('  ok  the navidrome sign-out button posts /online/logout')

// ── Signed out, the card hands off to the shared login window ─────────────
// It must not render a second copy of the credential form: that duplicate is
// what let the keep-password option exist in one place and not the other. The
// single form lives in the login window, and this card only opens it.
internals.onlineStore.set({
  provider: 'navidrome',
  results: [],
  phase: 'idle',
  playlists: [],
  providers: {
    navidrome: { loggedIn: false, capabilities: { loginPassword: true, loginQr: false } },
  },
})

const signedOutTree = render()
const hasClass = (node, name) =>
  !!node.props &&
  typeof node.props.className === 'string' &&
  node.props.className.split(/\s+/).filter(Boolean).includes(name)

const navCardSignedOut = []
walk(signedOutTree, (node) => {
  if (hasClass(node, 'is-navidrome')) navCardSignedOut.push(node)
})
assert.equal(navCardSignedOut.length, 1, 'the navidrome card still renders when signed out')

const cardInputs = []
const cardSwitches = []
walk(navCardSignedOut[0], (node) => {
  if (node.type === 'input') cardInputs.push(node)
  if (hasClass(node, 'mp-switch') || (node.props && node.props.role === 'switch')) cardSwitches.push(node)
})
assert.equal(cardInputs.length, 0, 'the card renders no credential fields of its own')
assert.equal(cardSwitches.length, 0, 'the card renders no keep-password switch of its own')

// The card's primary action opens the shared window instead.
const cardButtons = []
walk(navCardSignedOut[0], (node) => {
  if (node.type === 'button' && node.props && typeof node.props.onClick === 'function') cardButtons.push(node)
})
assert.ok(cardButtons.length >= 1, 'the signed-out card still offers a way in')

const overlayBefore = JSON.stringify(internals.overlayStore.get().layers || [])
cardButtons[0].props.onClick()
const layersAfter = internals.overlayStore.get().layers || []
const opened = layersAfter[layersAfter.length - 1]
assert.ok(opened, 'clicking the card pushes a layer')
assert.equal(opened.kind, 'login', 'the card opens the shared login window')
assert.equal(opened.props && opened.props.provider, 'navidrome', 'the window opens on navidrome')
assert.notEqual(JSON.stringify(layersAfter), overlayBefore, 'the layer stack actually changed')

console.log('  ok  the settings card opens the shared login window for navidrome')

// ── No stray standalone credential layer may come back ────────────────────
// The `navidrome` overlay kind is retired: its render branch was removed with
// the dialog file, so any remaining `pushLayer('navidrome')` would push a layer
// nothing draws — a button that silently does nothing. This scan is cheap and
// catches the leftover in online.js (expired-session relogin and the
// "enable full library" footer) before it ships again.
const CLIENT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'client')

function collectSources(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectSources(full, out)
    else if (entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

const offenders = []
for (const file of collectSources(CLIENT_DIR)) {
  const text = readFileSync(file, 'utf8')
  if (/pushLayer\(\s*'navidrome'/.test(text)) offenders.push(file + ': pushLayer("navidrome")')
  if (/kind\s*===\s*'navidrome'/.test(text)) offenders.push(file + ': renders layer kind "navidrome"')
}
assert.deepEqual(offenders, [], 'the retired navidrome layer must not be pushed or rendered')

console.log('  ok  no layer pushes the retired navidrome kind')
console.log('\npanel.navidrome-logout.test.mjs ok')
