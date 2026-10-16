/**
 * Talking to the runcommand CLI: reading what `runcommand json` prints, and finding the CLI
 * where Claude Code's own PATH does not have it.
 *
 * Pure, apart from the hooks module, so the tests can hold it to exact inputs.
 */
import type { RunCommand, RunLine } from '../types'

/**
 * `runcommand json`'s one line, or null when it is not that.
 *
 * Read the way the OpenCode plugin reads it: anything malformed is dropped rather than drawn,
 * and a line with nothing in it is still a line (the band then draws nothing).
 */
export function parseRun(stdout: string): RunLine | null {
  const text = stdout.split('\n').find(line => line.trim().length > 0)
  if (text === undefined) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { commands, ports, detecting } = parsed as Record<string, unknown>
  return {
    commands: Array.isArray(commands) ? commands.flatMap(toCommand) : [],
    ports: Array.isArray(ports) ? ports.filter(isPort) : [],
    detecting: detecting === true,
  }
}

function toCommand(value: unknown): RunCommand[] {
  if (typeof value !== 'object' || value === null) return []
  const { label, command } = value as Record<string, unknown>
  const one = typeof command === 'string' ? oneLine(command) : ''
  if (one.length === 0) return []
  const named = typeof label === 'string' ? oneLine(label) : ''
  return named.length > 0 ? [{ label: named, command: one }] : [{ command: one }]
}

/**
 * Text as one line of plain text: each run of control characters (a newline, a tab, an escape
 * sequence's ESC) becomes one space. A `.runcommand` file comes with whatever repository was
 * cloned, so nothing in it gets to move the cursor or open a link in the terminal.
 */
function oneLine(text: string): string {
  return text.replace(/\s*[\u0000-\u001f\u007f-\u009f]+\s*/g, ' ').trim()
}

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 65536
}

/** Whether two answers draw the same, so an unchanged one redraws nothing. */
export function sameRun(a: RunLine | null, b: RunLine | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * `RUNCOMMAND_CMD` as an argv: words split on whitespace, with single and double quotes and
 * backslashes doing what a shell does with them, so a path with a space in it can be quoted.
 * The OpenCode plugin reads the same variable; there it is split on spaces alone.
 */
export function splitCommand(text: string): string[] {
  const words: string[] = []
  let word = ''
  let isWord = false
  let quote: "'" | '"' | null = null
  for (let i = 0; i < text.length; i++) {
    const char = text[i] ?? ''
    if (quote === "'") {
      if (char === "'") quote = null
      else word += char
    } else if (char === '\\' && i + 1 < text.length) {
      word += text[++i] ?? ''
      isWord = true
    } else if (quote === '"') {
      if (char === '"') quote = null
      else word += char
    } else if (char === "'" || char === '"') {
      quote = char
      isWord = true
    } else if (/\s/.test(char)) {
      if (isWord) words.push(word)
      word = ''
      isWord = false
    } else {
      word += char
      isWord = true
    }
  }
  if (isWord) words.push(word)
  return words
}

/**
 * What the person's shell prints for `SHELL_PROBE`: where `runcommand` is, and the PATH that
 * found it.
 *
 * The probe runs as an interactive login shell, so a profile may print anything around it
 * (a greeting, a prompt's escape codes); the markers find the two lines among whatever else.
 */
export const SHELL_PROBE = `printf '\\n__runcommand_bin__%s\\n__runcommand_path__%s\\n' "$(command -v runcommand)" "$PATH"`

export function parseShellProbe(stdout: string): { bin: string; path: string } | null {
  const bin = /^__runcommand_bin__(.*)$/m.exec(stdout)?.[1]?.trim()
  const path = /^__runcommand_path__(.*)$/m.exec(stdout)?.[1]?.trim()
  // An alias or a function answers `command -v` with something other than a path.
  if (bin === undefined || !bin.startsWith('/') || path === undefined || path.length === 0) return null
  return { bin, path }
}
