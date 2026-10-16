/**
 * The line as a tree of Claude Code's own elements, one builder per surface.
 *
 * The terminal gets the status line's own look: the icon and labels dim, each command in its
 * palette color, the ports as OSC 8 links (`Link` takes any URL there).
 *
 * The desktop app gets one `Markdown` instead. The app draws a `Link` only to an `https:` URL
 * and draws any other as plain text, so `http://localhost:3000` would not be clickable; a link
 * inside `Markdown`, drawn the way an assistant reply is, may be `http:`. The commands go in
 * code spans, which is how the app sets a command anywhere else.
 */
import type { ElementTable, RenderElement } from 'claude-code'

import type { RunLine } from '../types'

/** The CLI's own presentation settings, read from the same variables it reads. */
export type LineStyle = {
  /** `RUNCOMMAND_ICON`; empty drops it. */
  icon: string
  /** `RUNCOMMAND_LABEL`, drawn before an unlabeled command. */
  label: string
  /** `RUNCOMMAND_COLORS`, as color names, cycled by position. */
  colors: readonly string[]
  /** False under `RUNCOMMAND_NO_PORTS`. */
  showPorts: boolean
}

/** The CLI's default palette, `36,33,35,34,32`: cyan, amber, magenta, blue, green. */
const PALETTE = ['cyan', 'yellow', 'magenta', 'blue', 'green'] as const

export const DEFAULT_STYLE: LineStyle = { icon: '▶', label: '', colors: PALETTE, showPorts: true }

const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const

/**
 * `RUNCOMMAND_COLORS` (comma-separated SGR codes) as the names a `Text` takes. The sixteen
 * plain codes map to their names, so the terminal's own palette still draws them, as it does
 * the status line; a code this does not know keeps the default palette's color in its place.
 */
export function paletteFrom(codes: string | undefined): readonly string[] {
  if (codes === undefined || codes.trim().length === 0) return PALETTE
  const colors = codes
    .split(',')
    .map(code => code.trim())
    .filter(code => code.length > 0)
    .map((code, i) => {
      const n = /^\d+$/.test(code) ? Number(code) : NaN
      if (n >= 30 && n <= 37) return ANSI[n - 30]
      if (n >= 90 && n <= 97) return `${ANSI[n - 90]}Bright`
      return PALETTE[i % PALETTE.length]
    })
  return colors.length > 0 ? colors.filter(color => color !== undefined) : PALETTE
}

/** Whether the line has anything to draw. */
function isEmpty(line: RunLine, style: LineStyle): boolean {
  const ports = style.showPorts ? line.ports : []
  return !line.detecting && line.commands.length === 0 && ports.length === 0
}

/** Where a port goes. */
const urlOf = (port: number): string => `http://localhost:${port}`

/** True while the first detection runs and there is no command to show yet. */
const isLooking = (line: RunLine): boolean => line.detecting && line.commands.length === 0

/**
 * The terminal's row: `▶ pnpm dev  ◉ :3000 :5173`, one line, truncated rather than wrapped,
 * so it never takes a second row of the band other mods share.
 */
export function terminalRow(
  line: RunLine,
  style: LineStyle,
  { Text, Link }: Pick<ElementTable<'terminal'>, 'Text' | 'Link'>,
): RenderElement | null {
  if (isEmpty(line, style)) return null
  const ports = style.showPorts ? line.ports : []
  const hasRun = isLooking(line) || line.commands.length > 0
  return (
    <Text wrap="truncate-end">
      {style.icon.length > 0 ? <Text dimColor>{`${style.icon} `}</Text> : null}
      {isLooking(line) ? <Text dimColor>{`${style.label}finding run command…`}</Text> : null}
      {line.commands.map((one, i) => (
        <Text>
          {i > 0 ? <Text dimColor> · </Text> : null}
          {one.label !== undefined ? (
            <Text dimColor>{`${one.label}: `}</Text>
          ) : style.label.length > 0 ? (
            <Text dimColor>{style.label}</Text>
          ) : null}
          <Text color={style.colors[i % style.colors.length] ?? 'cyan'}>{one.command}</Text>
        </Text>
      ))}
      {ports.length > 0 ? <Text dimColor>{hasRun ? '  ◉ ' : '◉ '}</Text> : null}
      {ports.map((port, i) => (
        <Text>
          {i > 0 ? ' ' : null}
          <Link href={urlOf(port)}>
            <Text color="cyan">{`:${port}`}</Text>
          </Link>
        </Text>
      ))}
    </Text>
  )
}

/** The desktop's row: the same line as one `Markdown`, dim while it is still looking. */
export function desktopRow(
  line: RunLine,
  style: LineStyle,
  { Markdown }: Pick<ElementTable<'desktop'>, 'Markdown'>,
): RenderElement | null {
  const text = markdownLine(line, style)
  if (text === null) return null
  return <Markdown text={text} dimColor={isLooking(line)} />
}

/** The desktop's line as markdown, or null when there is nothing to draw. */
export function markdownLine(line: RunLine, style: LineStyle): string | null {
  if (isEmpty(line, style)) return null
  const icon = style.icon.length > 0 ? `${escapeMarkdown(style.icon)} ` : ''
  const run = isLooking(line)
    ? `${escapeMarkdown(style.label)}finding run command…`
    : line.commands
        .map(one => {
          const label = one.label !== undefined ? `${escapeMarkdown(one.label)}: ` : escapeMarkdown(style.label)
          return label + codeSpan(one.command)
        })
        .join(' · ')
  const ports = (style.showPorts ? line.ports : []).map(port => `[:${port}](${urlOf(port)})`)
  const parts = [run, ports.length > 0 ? `◉ ${ports.join(' ')}` : '']
  return icon + parts.filter(part => part.length > 0).join(' · ')
}

/** `text` as a code span, fenced with one more backtick than any run inside it. */
export function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length))
  const fence = '`'.repeat(longest + 1)
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${text}${pad}${fence}`
}

/** `text` with markdown's inline punctuation escaped, so a label draws as written. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]()<>#|~!]/g, char => `\\${char}`)
}
