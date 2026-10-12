/** Finished turns: the last reply row's id (and a key made from its text) mapped to the line drawn under it. */
export type Finished = Record<string, string>

declare module 'claude-code' {
  interface PluginState {
    'turn-timer': { finished: Finished }
  }
}
