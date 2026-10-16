/**
 * The pure parts: reading the CLI's answer, finding the CLI, and writing the line.
 */
import { describe, expect, test } from 'claude-code/testing'

import { parseRun, parseShellProbe, sameRun, splitCommand } from '../hooks/cli'
import { codeSpan, DEFAULT_STYLE, escapeMarkdown, markdownLine, paletteFrom } from '../hooks/line'

describe('parseRun', () => {
  test('reads the one line `runcommand json` prints', () => {
    const line = JSON.stringify({
      root: '/work/app',
      commands: [{ label: 'web', command: 'pnpm dev:web' }, { command: 'pnpm dev:api' }],
      ports: [3000],
      detecting: false,
    })
    expect(parseRun(`\n${line}\n`)).toEqual({
      commands: [{ label: 'web', command: 'pnpm dev:web' }, { command: 'pnpm dev:api' }],
      ports: [3000],
      detecting: false,
    })
  })

  test('drops what it cannot draw rather than drawing it', () => {
    const line = JSON.stringify({
      commands: [{ command: '' }, { label: 7, command: 'make\n  serve' }, 'pnpm dev', null],
      ports: [80, '3000', 0, 70000, 1.5],
    })
    expect(parseRun(line)).toEqual({
      commands: [{ command: 'make serve' }],
      ports: [80],
      detecting: false,
    })
  })

  test('keeps what a cloned repository wrote to one line of plain text', () => {
    const line = JSON.stringify({
      commands: [
        { label: 'web\n# owned', command: '\u001b]8;;https://example.com\u0007pnpm dev' },
        { label: '\u001b[2J', command: 'make\tserve' },
      ],
    })
    expect(parseRun(line)?.commands).toEqual([
      { label: 'web # owned', command: ']8;;https://example.com pnpm dev' },
      { label: '[2J', command: 'make serve' },
    ])
  })

  test('is null for anything that is not that line', () => {
    expect(parseRun('')).toBeNull()
    expect(parseRun('statusline error: boom')).toBeNull()
    expect(parseRun('[3000]')).toEqual({ commands: [], ports: [], detecting: false })
    expect(parseRun('null')).toBeNull()
  })

  test('tells an unchanged answer from a new one', () => {
    const a = parseRun('{"commands":[{"command":"pnpm dev"}],"ports":[3000]}')
    expect(sameRun(a, parseRun('{"commands":[{"command":"pnpm dev"}],"ports":[3000]}'))).toBe(true)
    expect(sameRun(a, parseRun('{"commands":[{"command":"pnpm dev"}],"ports":[]}'))).toBe(false)
    expect(sameRun(null, null)).toBe(true)
  })
})

describe('splitCommand', () => {
  test('splits RUNCOMMAND_CMD as a shell would', () => {
    expect(splitCommand('runcommand')).toEqual(['runcommand'])
    expect(splitCommand('  node   /src/bin/runcommand.mjs ')).toEqual(['node', '/src/bin/runcommand.mjs'])
    expect(splitCommand(`'/Applications/My Tools/node' "/src/it's/cli.mjs"`)).toEqual([
      '/Applications/My Tools/node',
      "/src/it's/cli.mjs",
    ])
    expect(splitCommand('/opt/my\\ tools/node x')).toEqual(['/opt/my tools/node', 'x'])
    expect(splitCommand(`a '' b`)).toEqual(['a', '', 'b'])
    expect(splitCommand('')).toEqual([])
  })
})

describe('parseShellProbe', () => {
  test('finds the two marked lines among whatever a profile prints', () => {
    const stdout =
      '\u001b]1337;SetMark\u0007Last login: Tue\n\n' +
      '__runcommand_bin__/Users/me/Library/pnpm/bin/runcommand\n' +
      '__runcommand_path__/Users/me/Library/pnpm/bin:/usr/bin:/bin\n'
    expect(parseShellProbe(stdout)).toEqual({
      bin: '/Users/me/Library/pnpm/bin/runcommand',
      path: '/Users/me/Library/pnpm/bin:/usr/bin:/bin',
    })
  })

  test('is null when the shell does not have it either', () => {
    expect(parseShellProbe('__runcommand_bin__\n__runcommand_path__/usr/bin:/bin\n')).toBeNull()
    // An alias answers `command -v` with its definition, which is no path to run.
    expect(parseShellProbe("__runcommand_bin__alias runcommand='rc'\n__runcommand_path__/bin\n")).toBeNull()
    expect(parseShellProbe('zsh: command not found: printf')).toBeNull()
  })
})

describe('the desktop line', () => {
  const line = (commands: { label?: string; command: string }[], ports: number[] = []) => ({
    commands,
    ports,
    detecting: false,
  })

  test('labels each service and sets each command in code', () => {
    expect(
      markdownLine(
        line([{ label: 'web', command: 'pnpm dev:web' }, { label: 'api', command: 'pnpm dev:api' }], [3000]),
        DEFAULT_STYLE,
      ),
    ).toBe('▶ web: `pnpm dev:web` · api: `pnpm dev:api` · ◉ [:3000](http://localhost:3000)')
  })

  test('draws live ports even with no command known', () => {
    expect(markdownLine(line([], [8080]), DEFAULT_STYLE)).toBe('▶ ◉ [:8080](http://localhost:8080)')
  })

  test('says it is still looking, beside any port already up', () => {
    const looking = { commands: [], ports: [3000], detecting: true }
    expect(markdownLine(looking, DEFAULT_STYLE)).toBe(
      '▶ finding run command… · ◉ [:3000](http://localhost:3000)',
    )
  })

  test('is nothing at all where there is nothing to say', () => {
    expect(markdownLine(line([]), DEFAULT_STYLE)).toBeNull()
    expect(markdownLine(line([], [3000]), { ...DEFAULT_STYLE, showPorts: false })).toBeNull()
  })

  test('takes the CLI\'s icon and label', () => {
    const style = { ...DEFAULT_STYLE, icon: '', label: 'run: ', showPorts: false }
    expect(markdownLine(line([{ command: 'cargo run' }], [3000]), style)).toBe('run: `cargo run`')
  })

  test('keeps a command whole whatever it holds', () => {
    expect(codeSpan('pnpm dev')).toBe('`pnpm dev`')
    expect(codeSpan('echo `date`')).toBe('`` echo `date` ``')
    expect(codeSpan('a ``b`` c')).toBe('```a ``b`` c```')
    expect(escapeMarkdown('web_[1]*')).toBe('web\\_\\[1\\]\\*')
  })
})

describe('paletteFrom', () => {
  test('reads RUNCOMMAND_COLORS as the terminal\'s own color names', () => {
    expect(paletteFrom(undefined)).toEqual(['cyan', 'yellow', 'magenta', 'blue', 'green'])
    expect(paletteFrom('35, 32')).toEqual(['magenta', 'green'])
    expect(paletteFrom('91,97')).toEqual(['redBright', 'whiteBright'])
    // A code it cannot name keeps the default palette's color in its place.
    expect(paletteFrom('38;5;208,33')).toEqual(['cyan', 'yellow'])
    expect(paletteFrom(' , ')).toEqual(['cyan', 'yellow', 'magenta', 'blue', 'green'])
  })
})
