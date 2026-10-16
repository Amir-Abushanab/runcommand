/**
 * The band, driven through the engine: the hooks module loaded as a session loads it, the world
 * beneath it (the clock, the environment, the session, the processes it runs) standing in.
 *
 * `runcommand json` is never really run: the `process.run` hook below answers for it, so each
 * test says what the CLI printed and reads back what the band drew from it.
 */
import type { On, ProcessRunInit } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

const CWD = '/work/app'

const BAND = {
  plugin: 'runcommand',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const ONE = JSON.stringify({
  root: CWD,
  commands: [{ command: 'pnpm dev' }],
  ports: [3000, 5173],
  detecting: false,
})

/** What a process printed, or null for a command that cannot be started. */
type Printed = { stdout: string; exitCode?: number } | null

type World = {
  surfaces?: readonly ('terminal' | 'desktop')[]
  env?: Readonly<Record<string, string>>
  /** Answers each `$.process.run`; `runcommand json` printing ONE unless told otherwise. */
  answer?: (argv: readonly string[], init: ProcessRunInit | undefined) => Printed
}

type Ran = { argv: readonly string[]; path: string | undefined }

/** The world beneath the mod, and a record of every process it ran. */
function world(on: On, { surfaces = ['desktop'], env = {}, answer = () => ({ stdout: ONE }) }: World) {
  const clock = mock.clock(on)
  mock.env(on, env)
  const ran: Ran[] = []
  on('session.surfaces', () => ({ value: surfaces }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  // The engine's own band: empty, as it is with no survey up.
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ key: 'engine' }))
  on('process.run', ($, e) => {
    ran.push({ argv: e.argv, path: e.init?.env?.['PATH'] })
    const printed = answer(e.argv, e.init)
    if (printed === null) return { deny: `${e.argv[0]}: not found` }
    return {
      value: {
        exitCode: printed.exitCode ?? 0,
        stdout: printed.stdout,
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  return { clock, ran }
}

describe('in the desktop app', () => {
  test('draws the run command and its ports as one markdown line', async ($, on) => {
    const { clock, ran } = world(on, {})
    await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
    await clock.advance(1)

    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const line = await ui.find({ type: 'Markdown' })
    expect(line?.text).toBe(
      '▶ `pnpm dev` · ◉ [:3000](http://localhost:3000) [:5173](http://localhost:5173)',
    )
    expect(ran[0]?.argv).toEqual(['runcommand', 'json', '--project', CWD])
    // What the engine, or a mod beneath this one, drew is kept under the line, not replaced.
    expect(await ui.find({ key: 'engine' })).toBeDefined()
  })

  test('says it is still looking while the first detection runs', async ($, on) => {
    const detecting = JSON.stringify({ root: CWD, commands: [], ports: [], detecting: true })
    const { clock } = world(on, { answer: () => ({ stdout: detecting }) })
    await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
    await clock.advance(1)

    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect((await ui.find({ type: 'Markdown' }))?.text).toBe('▶ finding run command…')
  })

  test('follows the ports as servers start', async ($, on) => {
    let ports: number[] = []
    const { clock } = world(on, {
      answer: () => ({
        stdout: JSON.stringify({ root: CWD, commands: [{ command: 'pnpm dev' }], ports, detecting: false }),
      }),
    })
    await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
    await clock.advance(1)
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect((await ui.find({ type: 'Markdown' }))?.text).toBe('▶ `pnpm dev`')

    ports = [4321]
    await clock.advance(5_000)
    expect((await ui.find({ type: 'Markdown' }))?.text).toBe(
      '▶ `pnpm dev` · ◉ [:4321](http://localhost:4321)',
    )
  })

  test('yields the band to a survey', async ($, on) => {
    const { clock } = world(on, {})
    await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
    await clock.advance(1)

    const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, hasSurvey: true } })
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  })

  test('finds the CLI through the login shell when the app was started without it on PATH', async ($, on) => {
    const bin = '/Users/me/Library/pnpm/bin/runcommand'
    const path = '/Users/me/Library/pnpm/bin:/usr/bin:/bin'
    const { clock, ran } = world(on, {
      env: { SHELL: '/bin/zsh' },
      answer: argv => {
        if (argv[0] === 'runcommand') return null
        if (argv[0] === '/bin/zsh') {
          return { stdout: `Welcome back!\n\n__runcommand_bin__${bin}\n__runcommand_path__${path}\n` }
        }
        return { stdout: ONE }
      },
    })
    await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
    await clock.advance(1)

    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect((await ui.find({ type: 'Markdown' }))?.text).toContain('`pnpm dev`')
    expect(ran.map(one => one.argv[0])).toEqual(['runcommand', '/bin/zsh', bin])
    expect(ran[2]).toEqual({ argv: [bin, 'json', '--project', CWD], path })

    // Found once: later ticks go straight to it.
    await clock.advance(5_000)
    expect(ran.map(one => one.argv[0])).toEqual(['runcommand', '/bin/zsh', bin, bin])
  })

  test('runs RUNCOMMAND_CMD as written, and looks nowhere else when it fails', async ($, on) => {
    const { clock, ran } = world(on, {
      env: { RUNCOMMAND_CMD: "'/opt/my tools/node' /src/runcommand/bin/runcommand.mjs", SHELL: '/bin/zsh' },
      answer: () => null,
    })
    await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
    await clock.advance(1)

    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    expect(ran).toEqual([
      {
        argv: ['/opt/my tools/node', '/src/runcommand/bin/runcommand.mjs', 'json', '--project', CWD],
        path: undefined,
      },
    ])
  })
})

describe('in a terminal', () => {
  test('leaves the line to the status line, and runs nothing', async ($, on) => {
    const { clock, ran } = world(on, { surfaces: ['terminal'] })
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    await clock.advance(10_000)

    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ text: 'pnpm dev' })).toBeUndefined()
    expect(ran).toEqual([])
  })

  test('draws the status line\'s own line when asked to', { options: { terminal: true } }, async ($, on) => {
    const { clock } = world(on, { surfaces: ['terminal'] })
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    await clock.advance(1)

    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    // One row, as the status line draws it: the icon, the command in its color, then the ports.
    expect((await ui.find({ type: 'Text' }))?.text).toMatch(/^▶ pnpm dev {2}◉ /)
    expect(await ui.find({ type: 'Text', text: 'pnpm dev' })).toBeDefined()
    const links = await ui.findAll({ type: 'Link' })
    expect(links.map(link => link.props)).toEqual([
      { href: 'http://localhost:3000' },
      { href: 'http://localhost:5173' },
    ])
  })
})
