/** One service's command, as `runcommand json` reports it. */
export type RunCommand = { label?: string; command: string }

/** What `runcommand json` reported for the session's directory. */
export type RunLine = {
  commands: RunCommand[]
  ports: number[]
  /** True while a detection runs in the background and no command is known yet. */
  detecting: boolean
}

declare module 'claude-code' {
  interface PluginState {
    /** `line` is null until the CLI first answers, and again whenever it cannot be run. */
    runcommand: { line: RunLine | null }
  }
}
