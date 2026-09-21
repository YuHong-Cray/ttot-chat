/**
 * ttot-chat UI half — mounts the floating chat entry button into the DSH Web GUI.
 *
 * Deployed rows name this FILE BY ABSOLUTE PATH (/root/test/ttot-chat/lib/ui.js).
 * Because the loader turns an absolute name into a file URL, a process that
 * already cached lib/index.js (module HMR is config-only) still imports this
 * file fresh — which is how a running process picks up a button fix without a
 * restart. Idempotent: the injected HTML marker stops double injection.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chatButtonTransform } from './button-script.js'

export const name = 'ttot-ui'
export const inject = ['webServer']

/** Distinct from lib/index.js's guard so both halves may coexist. */
const UI_KEY = '__ttotChatUiMountedV2'
/** Revision of the injected script; also written to the mount marker. */
export const UI_REV = 3
let mounts = 0

export function apply(ctx) {
  if (globalThis[UI_KEY]) return
  const webServer = ctx && (ctx.webServer || (typeof ctx.get === 'function' ? ctx.get('webServer') : null))
  if (!webServer || typeof webServer.tapIndex !== 'function') return
  globalThis[UI_KEY] = true
  mounts += 1
  const disposer = webServer.tapIndex(chatButtonTransform(Number(process.env.TTOT_HTTP_PORT || 3000)))
  // Mount marker: proves which process/module revision registered the tap.
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    fs.writeFileSync(path.join(here, '..', 'app', '.ttot-ui.json'), JSON.stringify({
      rev: UI_REV,
      via: 'lib/ui.js',
      pid: process.pid,
      mountedAt: new Date().toISOString(),
    }, null, 2))
  } catch { /* best effort */ }
  try {
    ctx.effect(() => () => {
      mounts -= 1
      if (mounts > 0) return
      mounts = 0
      delete globalThis[UI_KEY]
      try { disposer() } catch { /* best effort */ }
    })
  } catch { /* no effect API available: the tap lives until process end */ }
}