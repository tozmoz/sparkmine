# Sparkmine: Idle Clicker Game for Claude Code

A game you play while Claude works, built as a
[Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview).
Claude works. You click.

Plays in the Code tab of the **Claude Desktop app** and in Claude Code in the
terminal.

![The band above the prompt: a pixel miner digs while Claude works](docs/band.png)

While Claude works, a pixel miner digs in the band above your prompt. Every
tool call Claude makes mines sparks ✻, and each press of **Mine** mines more.
Claude's own work pays too: a test run that passes, a commit, a long turn.
Spend it all in the shop on a crew that keeps digging, and on upgrades.

<img src="docs/shop.png" alt="The shop in the Claude Desktop app: upgrades, a new shaft, the layers, achievements and stats" width="420">

## Install

Needs Claude Code v2.1.293 or later. In a terminal, run:

```bash
claude plugin marketplace add tozmoz/sparkmine
claude plugin install sparkmine@sparkmine --scope user
```

The user scope puts it in every session, including the Code tab of the Claude
Desktop app. New sessions load it; in open ones, run `/reload-plugins`. Inside Claude Code, `/plugin install sparkmine --marketplace
tozmoz/sparkmine` does the same.

To update later:

```bash
claude plugin marketplace update sparkmine
claude plugin update sparkmine@sparkmine
```

## Play

- Press **Mine** while Claude works. Clicks count only then. In the
  terminal, give the band the keyboard (click it, or press ctrl+x then Tab)
  and press `m`: every press counts, while quick clicks on one spot count as
  one.
- Open the shop with **Shop** or `/mine`. Producers mine every second Claude
  works; upgrades make clicks, tool calls and the crew stronger. The shop's
  stats show where your sparks came from.
- **Claude's work pays**, once a turn each: tests that pass, a bug squashed
  (tests that failed, then pass), a build that passes, a clean lint, a commit,
  a pull request opened or merged, and a turn longer than five minutes. Every
  third good turn in a row pays a streak.
- **Veins:** now and then a gold vein shows beside the Shop sign for ten
  seconds. Catch it for two minutes of income, or a ×5 frenzy for thirty.
- **Depth:** the mine goes a hundred metres deeper with every tenfold of
  sparks, through seven layers. Each layer you reach adds its perk for the
  rest of the run.

  ![The seven layers, where each starts and what it adds](docs/layers.png)

- **New shaft:** from 500 m down, open a new shaft in the shop to start over
  for ◈ ancient stones. Each adds 10% to everything for good, and a deeper run
  pays more of them.
- **Achievements:** 23 badges for records such as your first vein, 100
  commits, a ten-turn streak or reaching the magma. Each adds 2% to everything, and they stay
  through new shafts.

All your sessions share one save, so they mine into the same mine.

| Command | What it does |
| :- | :- |
| `/mine` | Opens the shop |
| `/mine share` | Puts a card of your mine in the conversation to paste anywhere (in the terminal, on the clipboard too) |
| `/mine stop`, `/mine start` | Stops the game in every session, and starts it again |
| `/mine compact` | Keeps the band to one line, even while Claude works |
| `/mine hide`, `/mine show` | Hides the band in this session, and brings it back |
| `/mine reset` | Deletes your save, after asking |

To remove it, disable or uninstall it from `/plugin`. Your save stays until
you reset it.

## What it touches

- It **DOES NOT** use tokens: it never calls a model and adds nothing to your
  prompts.
- It **DOES NOT** make network requests or run commands. Nothing leaves your
  machine.
- It counts tool calls, turns and permission prompts, and reads whether a
  test run passed or a commit landed, but changes none of them.
- It keeps one small save on your machine.

## Known limits

- In the terminal, quick clicks on one spot count as one. Press `m` instead.
- A mod cannot see a permission dialog, so the band keeps going while one is
  open. It rests only while Claude asks you a question or waits on a plan.
- Each machine keeps its own save.

## License

MIT
