// hermes-nous-wake: the Nous girl wakes up when you start a new Hermes chat.
// Plain ESM, loaded uncompiled by Hermes Desktop (no JSX). desktop/plugin.js is built from this file by
// build.py, which inlines the three frames (art/frame-*.webp) as data URIs: Desktop evaluates plugin.js
// from source, so files next to it can't be reached by URL.
//
// Trigger: every new chat. host.state.activeSessionId going from a session to null, the session.new keybind or
// palette command (window event hermes:new-session-shortcut), and a click on the sidebar's New Session row;
// the last two fire even when the screen already shows a fresh draft. Once at launch when it starts null.
// Surface: the wake plays inside the work window only (the chat surface, not the sidebar). A COMPOSER_AREAS.top
// slot lives inside every chat surface; from there we read the surface's box (the documented [data-chat-surface]
// hook, the same one themes target) and draw a fixed overlay exactly over it. A new chat waits for its surface
// to mount and never covers the sidebar or the whole app. Only a manual replay with no chat surface on screen
// (a settings page, say) falls back to a full-window SDK Dialog. Plus a status-bar eye, a ⌘K command,
// and Settings ▸ Plugins ▸ Nous Wake.

import { atom, COMPOSER_AREAS, Dialog, DialogContent, DialogTitle, host, ListRow, PALETTE_AREA, SegmentedControl, STATUSBAR_AREAS, Tip, useValue } from '@hermes/plugin-sdk'
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
// Module level, so components can remount without losing a wake in progress.
const playing = atom(false)          // a wake is running
const playingIn = atom(null)         // id of the chat surface it runs in; null = full-window fallback
const surfaces = new Map()           // id -> () => HTMLElement | null, one per mounted composer slot
let nextId = 1

function pickSurface() {
  const live = [...surfaces.entries()].map(([id, get]) => [id, get()]).filter(([, el]) => el && el.getBoundingClientRect().width > 0)
  const focused = live.find(([, el]) => el.contains(document.activeElement))
  return (focused || live[0] || [null])[0]
}

let pendingAuto = false              // a new chat asked for a wake before its surface mounted; the surface claims it

function startIn(id) { pendingAuto = false; playingIn.set(id); playing.set(true) }

// manual = the status-bar eye, the palette or Settings. An automatic wake (new chat) plays only inside the chat
// surface: it waits for the surface to mount and never covers the whole app. A manual replay with no chat on
// screen (a settings page, say) falls back to the full-window dialog.
function start(manual) {
  if (playing.get()) return
  const began = Date.now()
  // Timers, not requestAnimationFrame, so this still fires when the window is in the background.
  const attempt = () => {
    if (playing.get()) return
    const id = pickSurface()
    if (id != null) return startIn(id)
    if (Date.now() - began < 1500) return void setTimeout(attempt, 60)
    if (manual) startIn(null)
    else pendingAuto = true
  }
  setTimeout(attempt, 80)
}
const play = () => start(true)
const playAuto = () => start(false)
const stopWake = () => { playing.set(false); playingIn.set(null) }

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
    const goTimer = setTimeout(() => setGo(true), 30)
    t.push(setTimeout(() => setOff(true), calm ? CALM_OFF_AT : OFF_AT))
    t.push(setTimeout(onDone, calm ? CALM_DONE_AT : DONE_AT))
    const skip = () => onDone()
    window.addEventListener('keydown', skip, { once: true })
    return () => { t.forEach(clearTimeout); clearTimeout(goTimer); window.removeEventListener('keydown', skip) }
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
  const on = useValue(playing), where = useValue(playingIn)
  const isPlaying = on && where == null   // full-window fallback only
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
        onOpenChange: v => { if (!v) stopWake() },
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
            isPlaying ? jsx(Wake, { onDone: stopWake }) : null,
          ],
        }),
      }),
    ],
  })
}

// Inside each chat surface (composer top slot): draws the wake over exactly that surface.
function SurfaceWake() {
  const anchor = useRef(null)
  const id = useRef(0)
  if (!id.current) id.current = nextId++
  const where = useValue(playingIn), on = useValue(playing)
  const mine = on && where === id.current
  const [box, setBox] = useState(null)
  const [shift, setShift] = useState([0, 0])   // an ancestor with a filter/transform moves what 'fixed' is relative to
  const overlay = useRef(null)

  useEffect(() => {
    const me = id.current
    surfaces.set(me, () => anchor.current?.closest('[data-chat-surface]') || null)
    // A new chat asked for a wake before this surface existed: it plays here, once the box is on screen.
    if (pendingAuto && !playing.get()) setTimeout(() => { if (pendingAuto && !playing.get() && surfaces.get(me)?.()) startIn(me) }, 80)
    return () => { surfaces.delete(me); if (playingIn.get() === me) stopWake() }
  }, [])

  useEffect(() => {
    if (!mine) return
    const el = surfaces.get(id.current)?.()
    if (!el) { stopWake(); return }
    const measure = () => { const r = el.getBoundingClientRect(); setBox({ left: r.left, top: r.top, width: r.width, height: r.height }) }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [mine])

  // After it paints, compare where the overlay landed with the surface and correct by the difference.
  useEffect(() => {
    if (!mine || !box || !overlay.current) return
    const r = overlay.current.getBoundingClientRect()
    const dx = box.left - r.left, dy = box.top - r.top
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) setShift(([x, y]) => [x + dx, y + dy])
  }, [mine, box])
  useEffect(() => { if (!mine) setShift([0, 0]) }, [mine])

  return jsxs('span', {
    ref: anchor,
    style: { display: 'contents' },
    children: mine && box ? jsx('div', {
      role: 'presentation',
      ref: overlay,
      style: { position: 'fixed', left: box.left + shift[0], top: box.top + shift[1], width: box.width, height: box.height, zIndex: 40, overflow: 'hidden', borderRadius: 'inherit' },
      children: jsx(Wake, { onDone: stopWake }),
    }) : null,
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

// Watch for a new chat from the plugin itself (not a component). Three signals, because the active session
// only changes when you leave an old chat: (1) host.state.activeSessionId going from a session to null;
// (2) the session.new keybind / palette command, which the app announces as a window event; (3) a click on
// the sidebar's New Session row or a date divider's "+", caught at the capture phase so it fires even when
// the screen already shows a fresh draft (clicking New Session twice in a row wakes her twice).
// One guard window keeps a click and its own session change from playing her twice.
let lastWake = 0
function wakeNow() {
  const now = Date.now()
  if (now - lastWake < 1200 || playing.get()) return
  lastWake = now
  markPlayed(); playAuto()
}
function isNewSessionControl(target) {
  const el = target instanceof Element ? target.closest('button,[role="button"],a') : null
  if (!el) return false
  if (el.querySelector('[data-tour="sidebar-nav-new-session"]')) return true
  const label = (el.getAttribute('aria-label') || '').trim().toLowerCase()
  return label === 'new session'
}
function watch(ctx) {
  const atomActive = host.state.activeSessionId
  let prev = atomActive.get()
  if (prev == null && allowed('launch')) wakeNow()                          // the app opened on the new-chat screen
  const stop = atomActive.listen(next => {
    const was = prev
    prev = next
    if (next != null) pendingAuto = false                                  // an old chat was opened instead
    if (was != null && next == null && allowed('chat')) wakeNow()
  })
  const onShortcut = () => { if (allowed('chat')) wakeNow() }
  const onClick = e => { if (allowed('chat') && isNewSessionControl(e.target)) wakeNow() }
  window.addEventListener('hermes:new-session-shortcut', onShortcut)
  document.addEventListener('click', onClick, true)
  ctx.onDispose?.(() => {
    stop()
    window.removeEventListener('hermes:new-session-shortcut', onShortcut)
    document.removeEventListener('click', onClick, true)
  })
}

export default {
  id: ID,
  name: 'Nous Wake',
  register(ctx) {
    storage = ctx.storage
    prefs.set({ ...DEFAULTS, ...ctx.storage.get('prefs', {}) })
    preload()
    watch(ctx)
    ctx.register({ id: 'surface', area: COMPOSER_AREAS.top, render: () => jsx(SurfaceWake, {}) })
    ctx.register({ id: 'watcher', area: STATUSBAR_AREAS.right, order: 140, render: () => jsx(Watcher, {}) })
    ctx.register({
      id: 'replay', area: PALETTE_AREA,
      data: { id: `${ID}.replay`, label: 'Nous Wake: watch her wake up', keywords: ['nous', 'wake', 'girl', 'eyes', 'intro'], run: play },
    })
    ctx.registerSettingsPage?.({ id: 'settings', title: 'Nous Wake', icon: 'eye', render: () => jsx(Settings, {}) })
  },
}
