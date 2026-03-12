# claude-statusline-cross

Configure your Claude Code statusline to show limits, directory and git info. Works on **Windows**, **macOS**, and **Linux**.

![demo](./.github/demo.png)

## Install

```bash
npx claude-statusline-cross
```

It backs up your old status line if any, copies the status line script to `~/.claude/statusline.js`, and configures your Claude Code settings.

## Requirements

- Node.js (already required by Claude Code)
- curl — for fetching rate limit data
- git — for branch info

## Uninstall

```bash
npx claude-statusline-cross --uninstall
```

If you had a previous statusline, it restores it from the backup. Otherwise it removes the script and cleans up your settings.

## License

MIT
