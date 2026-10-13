/** Finished turns: the last reply block's ids (its row's, and the desktop's own) mapped to the line drawn under it. */
export type Finished = Record<string, string>

declare module 'claude-code' {
  interface PluginState {
    'turn-timer': { finished: Finished }
  }
}
