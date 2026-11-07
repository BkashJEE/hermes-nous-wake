// hermes-nous-wake: the Nous girl wakes up when you start a new Hermes chat.
// Plain ESM, loaded uncompiled by Hermes Desktop (no JSX). desktop/plugin.js is built from this file by
// build.py, which inlines the three frames (art/frame-*.webp) as data URIs: Desktop evaluates plugin.js
// from source, so files next to it can't be reached by URL.
//
// Trigger: host.state.activeSessionId. A fresh chat draft (sidebar New Session, the session.new keybind,
// the palette) sets it to null; so does a cold start on the new-chat screen. We play when it goes from a
// session to null, and once at launch when it starts null.
// Surface: an SDK Dialog (no app-markup reaching, catalog rule 8), a status-bar eye that replays it,
// a ⌘K command, and Settings ▸ Plugins ▸ Nous Wake.

import { atom, Dialog, DialogContent, DialogTitle, host, ListRow, PALETTE_AREA, SegmentedControl, STATUSBAR_AREAS, Tip, useValue } from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'hermes-nous-wake'
const FRAMES = /*FRAMES*/ { closed: '', quarter: '', half: '', threeq: '', open: '' } /*END*/

// The wake, in ms from the start: tube switches on, she is asleep, her eyes open slowly
// (the three frames only differ at the eyes, so they crossfade without the hair moving), she looks, it switches off.
// Her lids lift in four steps: closed -> a sliver -> half -> three-quarters -> open. [frame, starts at ms, blend ms]
// Short blends between neighbouring frames read as one smooth lift; long ones double-expose the ink lids.
const STEPS = [['quarter', 700, 170], ['half', 960, 170], ['threeq', 1210, 170], ['open', 1460, 190]]
const OFF_AT = 2750                    // CRT shut-off starts
const DONE_AT = 3150
const CALM_OFF_AT = 900, CALM_DONE_AT = 1300   // prefers-reduced-motion: fade in open, fade out

const DEFAULTS = { mode: 'every' }   // every | daily | launch | off
const prefs = atom({ ...DEFAULTS })
let storage = null
const playing = atom(false)          // module level: the status-bar item can remount without losing a wake in progress
const play = () => playing.set(true)

function update(patch) {
  prefs.set({ ...prefs.get(), ...patch })
  storage?.set('prefs', prefs.get())
}

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

// Whether an automatic trigger may play under the current mode.
function allowed(kind) {
  const { mode } = prefs.get()
  if (mode === 'off') return false
  if (mode === 'launch') return kind === 'launch'
  if (mode === 'daily') {
    if (storage?.get('lastDay', '') === today()) return false
  }
  return true
}

function markPlayed() {
  storage?.set('lastDay', today())
}

const reduceMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

const CSS = /*CSS*/ '' /*ENDCSS*/

// The RGB split: red shifted right, blue left, green in place, screened back together.
function RgbFilter() {
  const m = (values, result) => jsx('feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values, result })
  return jsx('svg', { width: 0, height: 0, style: { position: 'absolute' }, 'aria-hidden': true, children: jsxs('filter', { id: 'nw-rgb', colorInterpolationFilters: 'sRGB', children: [
    m('1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0', 'r'), jsx('feOffset', { in: 'r', dx: 2.5, result: 'r2' }),
    m('0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0', 'g'),
    m('0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0', 'b'), jsx('feOffset', { in: 'b', dx: -2.5, result: 'b2' }),
    jsx('feBlend', { in: 'r2', in2: 'g', mode: 'screen', result: 'rg' }), jsx('feBlend', { in: 'rg', in2: 'b2', mode: 'screen' }),
  ] }) })
}

function Wake({ onDone }) {
  const calm = useRef(reduceMotion()).current
  const [step, setStep] = useState(calm ? STEPS.length : 0)   // how many STEPS have started
  const [go, setGo] = useState(false)
  const [off, setOff] = useState(false)

  useEffect(() => {
    const t = []
    if (!calm) STEPS.forEach(([, at], i) => t.push(setTimeout(() => setStep(i + 1), at)))
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setGo(true)))
    t.push(setTimeout(() => setOff(true), calm ? CALM_OFF_AT : OFF_AT))
    t.push(setTimeout(onDone, calm ? CALM_DONE_AT : DONE_AT))
    const skip = () => onDone()
    window.addEventListener('keydown', skip, { once: true })
    return () => { t.forEach(clearTimeout); cancelAnimationFrame(raf); window.removeEventListener('keydown', skip) }
  }, [])

  const img = (f, on, ms) => jsx('img', { alt: '', draggable: false, src: FRAMES[f], className: `nw-img${on ? ' nw-on' : ''}`, style: { transition: `opacity ${ms}ms ease-in-out` } })
  return jsxs('div', {
    className: `nw-stage${go ? ' nw-go' : ''}${off ? ' nw-off' : ''}${calm ? ' nw-calm' : ''}`,
    onClick: onDone,
    children: [
      jsx('style', { children: CSS }),
      jsx(RgbFilter, {}),
      jsxs('div', {
        className: 'nw-tube',
        children: [
          jsxs('div', { className: 'nw-pic', children: [img('closed', true, 0), ...STEPS.map(([f, , ms], i) => img(f, step > i, ms))] }),
          jsx('div', { className: 'nw-tint' }),
          jsx('div', { className: 'nw-glow' }),
          jsx('div', { className: 'nw-scan' }),
          jsx('div', { className: 'nw-roll' }),
          jsx('div', { className: 'nw-static' }),
          jsx('div', { className: 'nw-glass' }),
        ],
      }),
      jsx('div', { className: 'nw-skip', children: 'click to skip' }),
    ],
  })
}

// Lives in the status bar: the replay eye and the full-window dialog. New-chat detection is in watch(), not here.
function Watcher() {
  const isPlaying = useValue(playing)
  return jsxs('span', {
    style: { display: 'inline-flex', alignItems: 'center' },
    children: [
      jsx(Tip, {
        content: 'Nous Wake: replay',
        children: jsx('button', {
          type: 'button',
          'aria-label': 'Replay Nous Wake',
          onClick: play,
          style: { background: 'none', border: 0, padding: '0 6px', cursor: 'pointer', color: 'inherit', font: 'inherit', opacity: 0.75 },
          children: '◉',
        }),
      }),
      jsx(Dialog, {
        open: isPlaying,
        onOpenChange: v => { if (!v) playing.set(false) },
        children: jsxs(DialogContent, {
          showCloseButton: false,
          'aria-describedby': undefined,
          // A new chat focuses its composer right after we open; that must not count as "clicked outside".
          onOpenAutoFocus: e => e.preventDefault(),
          onCloseAutoFocus: e => e.preventDefault(),
          onFocusOutside: e => e.preventDefault(),
          onInteractOutside: e => e.preventDefault(),
          onPointerDownOutside: e => e.preventDefault(),
          style: { position: 'fixed', inset: 0, width: '100vw', height: '100vh', maxWidth: 'none', maxHeight: 'none', transform: 'none', translate: 'none', padding: 0, border: 0, borderRadius: 0, background: '#000', boxShadow: 'none' },
          children: [
            jsx(DialogTitle, { className: 'nw-sr', children: 'Nous girl waking up' }),
            isPlaying ? jsx(Wake, { onDone: () => playing.set(false) }) : null,
          ],
        }),
      }),
    ],
  })
}

const MODES = [
  { id: 'every', label: 'Every new chat' },
  { id: 'daily', label: 'First chat of the day' },
  { id: 'launch', label: 'App launch' },
  { id: 'off', label: 'Off' },
]

function Settings() {
  const { mode } = useValue(prefs)
  return jsxs('div', {
    children: [
      jsx(ListRow, {
        title: 'When she wakes up',
        description: 'On an old CRT, the Nous girl slowly opens her eyes, about three seconds. Click or press any key to skip.',
        action: jsx(SegmentedControl, { value: mode, onChange: m => update({ mode: m }), options: MODES }),
      }),
      jsx(ListRow, {
        title: 'Watch it now',
        description: 'With reduced motion turned on in your system, she fades in with her eyes open instead.',
        action: jsx('button', {
          type: 'button',
          onClick: play,
          style: { padding: '4px 12px', borderRadius: 6, border: '1px solid var(--ui-border, #444)', background: 'transparent', color: 'inherit', cursor: 'pointer' },
          children: 'Replay',
        }),
      }),
    ],
  })
}

// Decode the frames once, up front, so the first wake starts on time instead of stalling on image decode.
function preload() {
  for (const src of Object.values(FRAMES)) { try { const i = new Image(); i.src = src; i.decode?.().catch(() => {}) } catch {} }
}

// Watch the active session from the plugin itself (not a component): a fresh chat draft sets it to null.
function watch(ctx) {
  const atomActive = host.state.activeSessionId
  let prev = atomActive.get()
  if (prev == null && allowed('launch')) { markPlayed(); play() }      // the app opened on the new-chat screen
  const stop = atomActive.listen(next => {
    const was = prev
    prev = next
    if (was != null && next == null && allowed('chat')) { markPlayed(); play() }
  })
  ctx.onDispose?.(stop)
}

export default {
  id: ID,
  name: 'Nous Wake',
  register(ctx) {
    storage = ctx.storage
    prefs.set({ ...DEFAULTS, ...ctx.storage.get('prefs', {}) })
    preload()
    watch(ctx)
    ctx.register({ id: 'watcher', area: STATUSBAR_AREAS.right, order: 140, render: () => jsx(Watcher, {}) })
    ctx.register({
      id: 'replay', area: PALETTE_AREA,
      data: { id: `${ID}.replay`, label: 'Nous Wake: watch her wake up', keywords: ['nous', 'wake', 'girl', 'eyes', 'intro'], run: play },
    })
    ctx.registerSettingsPage?.({ id: 'settings', title: 'Nous Wake', icon: 'eye', render: () => jsx(Settings, {}) })
  },
}
