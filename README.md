# turn-timer

A Claude Code mod that shows how long each turn took, in a small chip under Claude's reply:

![A rounded chip with a grey stopwatch icon and "1m 39s"](docs/images/chip.png)

The desktop app's Code tab tells you when a turn finished, but not how long Claude worked on it. turn-timer adds that, quietly, under the last block of each reply.

## What it shows

- **A finished turn:** a grey stopwatch and the time, such as `1m 39s`. Under a minute it's seconds (`42s`), over an hour it's hours and minutes (`1h 04m`).
- **A turn you interrupted:** a small orange square and `stopped · 1m 05s`, like this:

  ![A rounded chip with a small orange square and "stopped · 20s"](docs/images/stopped.png)

  Orange is saved for this one case, because an interrupted turn is the one worth noticing.
- **Subagents' turns:** nothing. Only the main conversation's turns get a chip.
- **Surfaces that can't draw images, such as a terminal:** an italic line at the end of the reply instead, `took 3m 12s`.

The chip only changes what's drawn. The stored reply, and what Claude reads back, stay exactly as they were.

## Install

Mods install from a terminal. The desktop app's Code tab doesn't offer the `/plugin` command, so run these once in PowerShell, Terminal, or any shell where `claude` works:

```bash
claude plugin marketplace add Barncore/turn-timer
```

```bash
claude plugin install turn-timer@turn-timer --scope user
```

Then restart the desktop app, or start a new `claude` session.

To update later:

```bash
claude plugin marketplace update turn-timer
```

```bash
claude plugin update turn-timer@turn-timer --scope user
```

Then restart again. A running session keeps the copy it started with.

### What it needs

- **Claude Code 2.1.287 or later,** the release mods arrived in. They're on by default, but local settings, safe mode or an organisation policy can turn them off. See [Anthropic's mod docs](https://code.claude.com/docs/en/plugins/mods/overview#turn-mods-on-or-off).

## Good to know

- **The chip appears on replies that finish after turn-timer loads.** After you install it or restart the app, your earlier replies won't have one, because there's no record of how long they took. The next reply will.
- **A restart starts fresh.** The times live in the session's own state, which doesn't survive the app restarting.
- **It keeps the last 200 turns.** Scroll far enough back in a very long session and the oldest replies lose their chips.
- **One narrow case can still put a chip on the wrong reply.** During a turn, you scroll an older reply into view that the Code tab hadn't drawn since turn-timer loaded, and it ends with exactly the same words as this turn's reply. Then the older reply can take the chip.

## Tested on

- **Windows 11, the Claude desktop app's Code tab, Claude Code 2.1.295.** The chip has been seen drawing there, under real replies.
- **macOS: untested.** It should work. Mods are JavaScript run by Claude Code itself, and turn-timer touches no files, processes or OS features. But the desktop app draws mods itself, and a few drawing bugs have only been reported on Mac. If you try it on a Mac, an issue saying how it went would help.
- **Terminal:** the italic line is covered by the tests, but nobody has watched it in a real terminal yet.

## How it works

1. When Claude's reply arrives, turn-timer notes the id and the closing words of the reply's last block.
2. While the turn runs, it notes each block the Code tab draws for the first time.
3. When the turn ends, Claude Code reports how long it took. turn-timer stores that time against the block, once per turn.
4. When the Code tab draws that block, turn-timer draws the chip under the app's own drawing of the reply, so the reply keeps its formatting, text selection and copy button.

The Code tab draws a block under an id of its own (`msg_…-t0`), not the id the reply arrived with, and Claude Code doesn't hand that id to mods. So turn-timer links the two: the block drawn for the first time during this turn whose closing words match the reply's. A reply drawn before the turn started can't match, so an older reply ending with the same words, say `Done.`, never borrows a newer reply's time. If the Code tab only draws the block after the turn ends, turn-timer links the first new block drawn with those closing words. The terminal draws a block under the id the reply arrived with, so there it matches by id.

The stopwatch is one mid-grey (`#8a8883`) that reads on both the light and the dark theme, so turn-timer doesn't need to know which theme you use.

## What it can reach

From `claude plugin validate` on Claude Code 2.1.296:

```
hooks: turn.start, session.append, turn.complete, ui.render{component=AssistantMessage}
calls: $.clock.after, $.state.get, $.state.set, $.ui.resolve
```

In plain words: it sees turns start and end and replies arrive, and it draws under replies. It saves one small value per turn in the session's state. The clock call saves a link made while drawing once the drawing is done. It has no file, network or process access.

## Develop

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

## Licence

MIT, see [LICENSE](LICENSE).
