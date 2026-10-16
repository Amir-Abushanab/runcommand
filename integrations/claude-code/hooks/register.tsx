/**
 * runcommand's Claude Code mod: the project's run command, and the localhost ports it is
 * serving, in the band directly above the prompt.
 *
 * runcommand draws in Claude Code's status line, and the Claude desktop app's Code tab has no
 * status line. A mod can draw in the band above the prompt (the `AbovePrompt` render site),
 * which the app and the terminal both raise, so this draws the same line there. By default it
 * draws in the app alone: in a terminal the status line already shows it, and one session
 * shows one line. The `terminal` option draws it there too, for a terminal whose status line
 * slot is given to something else.
 *
 * Nothing is detected here. As the OpenCode plugin does, this runs `runcommand json` and draws
 * the parts it is handed, so detection, caching, overrides, port scoping and filtering all stay
 * in the one CLI; a miss there starts a background detection, exactly as the status line's does.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { RunLine } from '../types'
import { parseRun, parseShellProbe, sameRun, SHELL_PROBE, splitCommand } from './cli'
import { DEFAULT_STYLE, desktopRow, paletteFrom, terminalRow } from './line'
import type { LineStyle } from './line'

/** What the CLI last said about the session's directory: what the band draws from. */
const line = atom({ plugin: 'runcommand', key: 'line' } as const, null)

/** The OpenCode plugin's cadence. Each tick is one spawn that reads the CLI's disk cache. */
const REFRESH_MS = 5_000

/** `runcommand json` never waits on the model; this only bounds a wedged port scan. */
const RUN_TIMEOUT_MS = 10_000

/** An interactive shell can be slow to start, and it runs once, not on every tick. */
const PROBE_TIMEOUT_MS = 10_000

/** How long a failed search for the CLI stands before a tick searches again. */
const RETRY_MS = 60_000

/** How to run the CLI: its argv, and the PATH to run it with when Claude Code's lacks it. */
type Invocation = { readonly argv: readonly string[]; readonly path?: string }

const ON_PATH: Invocation = { argv: ['runcommand'] }

/** The variables the CLI's own status line reads to draw itself, read the same way. */
async function readStyle($: EngineInterface): Promise<LineStyle> {
  const [icon, label, colors, noPorts] = await Promise.all([
    $.env.get('RUNCOMMAND_ICON'),
    $.env.get('RUNCOMMAND_LABEL'),
    $.env.get('RUNCOMMAND_COLORS'),
    $.env.get('RUNCOMMAND_NO_PORTS'),
  ])
  return {
    icon: icon ?? DEFAULT_STYLE.icon,
    label: label ?? DEFAULT_STYLE.label,
    colors: paletteFrom(colors),
    showPorts: noPorts === undefined || noPorts === '',
  }
}

/**
 * Where the person's shell finds `runcommand`, and the PATH it found it on.
 *
 * The desktop app starts Claude Code with the PATH the app itself was started with. Opened from
 * the Dock, that can lack what a shell profile adds: `~/.zshrc` is where pnpm, bun and the Node
 * version managers put their directories, and an interactive login shell is the one that reads
 * it. The PATH comes back too, because a pnpm or npm shim runs `node` from PATH.
 */
async function lookUp($: EngineInterface): Promise<Invocation | null> {
  const shell = await $.env.get('SHELL')
  const shells = new Set(
    [shell, '/bin/zsh', '/bin/bash'].filter(
      (candidate): candidate is string => candidate !== undefined && candidate.startsWith('/'),
    ),
  )
  for (const candidate of shells) {
    try {
      const { stdout } = await $.process.run([candidate, '-ilc', SHELL_PROBE], {
        timeoutMs: PROBE_TIMEOUT_MS,
      })
      const found = parseShellProbe(stdout)
      if (found !== null) return { argv: [found.bin], path: found.path }
    } catch {
      // Not this shell; the next one.
    }
  }
  return null
}

/**
 * One `runcommand json` for `cwd`: the line, null when what came back is not one, or `missing`
 * when the CLI could not be run at all.
 */
async function runJson(
  $: EngineInterface,
  how: Invocation,
  cwd: string,
): Promise<RunLine | null | 'missing'> {
  try {
    const { exitCode, stdout } = await $.process.run([...how.argv, 'json', '--project', cwd], {
      timeoutMs: RUN_TIMEOUT_MS,
      ...(how.path === undefined ? {} : { env: { PATH: how.path } }),
    })
    // A shell's own "cannot execute" and "not found": a pnpm shim whose `node` is not on PATH.
    if (exitCode === 126 || exitCode === 127) return 'missing'
    return exitCode === 0 ? parseRun(stdout) : null
  } catch {
    return 'missing'
  }
}

/** Whether the person asked for the line in a terminal too: the manifest's `terminal` option. */
let inTerminal = false

/** The CLI's presentation settings, read at each session start. */
let style = DEFAULT_STYLE

/** How the CLI is run now, whether RUNCOMMAND_CMD chose it, and when the shell was last asked. */
let how = ON_PATH
let isOverridden = false
let lookedAt: number | undefined

let ticking: Timer | undefined
let isRefreshing = false

/** The surfaces this draws on: the app always, a terminal when asked to. */
function drawsOn(surface: string): boolean {
  return surface === 'desktop' || (inTerminal && surface === 'terminal')
}

/** The line for `cwd`, finding the CLI first where Claude Code's PATH does not have it. */
async function fetchLine($: EngineInterface, cwd: string): Promise<RunLine | null> {
  const answer = await runJson($, how, cwd)
  if (answer !== 'missing') return answer
  // RUNCOMMAND_CMD is the person's word on where it is; nothing is looked up past it.
  if (isOverridden) return null
  const now = await $.clock.now()
  if (lookedAt !== undefined && now - lookedAt < RETRY_MS) return null
  lookedAt = now
  const found = await lookUp($)
  if (found === null) return null
  how = found
  const retried = await runJson($, how, cwd)
  return retried === 'missing' ? null : retried
}

/** Asks the CLI again, only while a surface this draws on is attached. */
async function refresh($: EngineInterface): Promise<void> {
  if (isRefreshing) return
  isRefreshing = true
  try {
    if (!(await $.session.surfaces()).some(drawsOn)) return
    const next = await fetchLine($, await $.session.cwd())
    // An unchanged answer is not written, so it redraws nothing.
    if (!sameRun(await read($, line), next)) await update($, line, () => next)
  } catch {
    // The line stays as it was until the next tick.
  } finally {
    isRefreshing = false
  }
}

/** A refresh on the next turn of the clock, so the hook that asks for it is not held up. */
function soon($: EngineInterface): void {
  $.clock.after(1, () => void refresh($))
}

export const register: Register = (on, options) => {
  inTerminal = options['terminal'] === true

  on('session.start', async ($, e, next) => {
    // Also fired on every reload of the module, so one interval replaces the last.
    style = await readStyle($)
    const override = await $.env.get('RUNCOMMAND_CMD')
    const argv = override === undefined ? [] : splitCommand(override)
    isOverridden = argv.length > 0
    how = isOverridden ? { argv } : ON_PATH
    lookedAt = undefined
    ticking?.cancel()
    ticking = $.clock.every(REFRESH_MS, () => void refresh($))
    // The first line now rather than a tick from now, without holding up the session's start.
    soon($)
    return next(e)
  })

  // The app attaching is when a session becomes one this draws in.
  on('session.attach', ($, e, next) => {
    if (drawsOn(e.surface)) soon($)
    return next(e)
  })

  // A turn is what starts a dev server or edits a manifest, so its end is worth a look at once.
  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) soon($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // What the mods after this one draw: returned as is when there is nothing of ours, and kept
    // beneath our row otherwise, since a tree of our own would replace theirs.
    const theirs = await next(e)
    // A survey holds the band, and a hook yields to it.
    if (e.props.hasSurvey || !drawsOn(e.surface)) return theirs
    const current = await read($, line)
    if (current === null) return theirs
    const elements = $.ui.resolve(e)
    const mine =
      e.surface === 'terminal'
        ? terminalRow(current, style, elements)
        : desktopRow(current, style, elements)
    if (mine === null) return theirs
    const { Box } = elements
    return (
      <Box flexDirection="column">
        {mine}
        {theirs}
      </Box>
    )
  })
}
