# kb

> [!WARNING]
> This tool is vibe-coded. Use at your own risk.

Small CLI for saving, editing, and searching personal knowledge-base entries.
It stores entries in SQLite, keeps search fast with a local index, and stays entirely on your machine.

## Features

- Add notes with a question, tags, and a multi-line answer
- List all tags or create new standalone tags
- List all entries or filter by tag
- Open any entry by `#id`
- Edit entries in your terminal editor
- Track explicit `kb get` views and search history
- Link related notes with `kb link`
- Search questions, answers, and tags
- Store data locally with no external service

## Requirements

- Node.js with support for `--experimental-strip-types`
- npm

## Install

Install dependencies:

```bash
npm install
```

Run directly in dev mode:

```bash
npm run dev
```

Run against an isolated temp data root:

```bash
npm run dev:test
```

Optionally link the CLI locally:

```bash
npm link
kb
```

## Usage

```text
kb
kb add --answer="..." [--question=text] [--tag=tag]
kb add --stdin [--question=text] [--tag=tag]
kb add --from-clipboard [--question=text] [--tag=tag]
kb add --file=path --line-start=n --line-end=n --format=code-reference
kb list [--tag=tag]
kb tags
kb tags add tag
kb get #id
kb edit #id
kb link #id #id
kb remove #id
kb search "query"
```

## Examples

```bash
kb
kb add --question="SQLite FTS" --tag=sqlite --answer="Use unicode61 tokenizer"
pbpaste | kb add --stdin --tag=sqlite
kb add --from-clipboard --tag=chrome
kb add --file=src/app.ts --line-start=1 --line-end=8 --format=code-reference
kb list
kb list --tag=sqlite
kb tags
kb tags add sqlite
kb get #12
kb edit #12
kb link #12 #18
kb search "fts tokenizer"
```

## AGENTS.md / CLAUDE.md

Paste this into your `AGENTS.md` or `CLAUDE.md`:

````md
## Knowledge Base Tool

When the user asks you to save something to the knowledge base:

1. Optionally list existing tags with `kb tags`.
2. Add the entry with explicit flags:
   - `--question` for the question/title
   - `--tag` for one or more tags
   - `--answer` for the saved content

Example:

```bash
kb add \
  --question "How does SQLite FTS tokenization work?" \
  --tag sqlite \
  --tag fts \
  --answer "Use the unicode61 tokenizer for standard full-text search behavior."
```

Rules:
- Prefer explicit `kb add --question ... --tag ... --answer ...` over interactive entry.
- Repeat `--tag` for multiple tags.
- Use `kb tags` first when you want to reuse an existing tag set.
- Never invent new behaviors when writing the question or answer.
````

## Entry Flow

- `kb` starts a new entry prompt
- Enter the question first
- Pick existing tags or add new ones
- Type the answer across multiple lines
- Finish the answer with two blank lines
- Type `/editor` on the first answer line to switch to your editor

## Quick Capture

- `kb add --answer="..."` saves directly without prompts
- `kb add --stdin` reads the answer from standard input
- `kb add --from-clipboard` reads the answer from the macOS clipboard via `pbpaste`
- omit `--question` to derive it from the first cleaned sentence or line of the answer
- existing tags mentioned in the question or answer are auto-added
- explicit `--tag` flags are merged with detected tags

## Code References

- `kb add --file=path --line-start=n --line-end=n --format=code-reference` reads the selected code directly from disk
- code files must begin with a comment; `kb` uses that leading comment to infer the question
- markdown files use the normal cleaned-text question derivation instead
- `kb` stores a markdown answer with file, project, branch, commit, GitHub permalink when available, then a fenced code block
- project metadata is best-effort and never required for the save to succeed
- code-reference entries auto-tag only the current project name

## WebStorm

Create an External Tool with:

- Program: `kb`
- Arguments: `add --file="$FileRelativePath$" --line-start="$SelectionStartLine$" --line-end="$SelectionEndLine$" --format=code-reference`
- Working directory: `$ProjectFileDir$`
- Options: enable `Open console for tool output` and `Make console active on message in stderr`

This keeps the selected code source-of-truth on disk, avoids multiline quoting issues, and pops open the Run console on failures.

When editing an existing entry, `kb` opens your editor using `VISUAL`, then `EDITOR`, then `vi`.

## Metadata And History

- each entry stores how it was added, such as `interactive`, `inline`, `stdin`, `clipboard`, or `code-reference`
- `kb get #id` records a raw view event and updates the entry view count and last viewed time
- `kb search "query"` records a raw search event with the query and result count
- `kb link #id #id` creates an undirected link that appears on both linked entries

## Storage

`kb` stores data in:

- `$XDG_DATA_HOME/kb` when `XDG_DATA_HOME` is set
- `~/.local/share/kb` otherwise

Files:

- `kb.sqlite` for entries and tags
- `search-index.json` for the search index
- `backups/kb-YYYY-MM-DD.sqlite` for daily SQLite backups
- `backups/kb-pre-migration-YYYY-MM-DDTHH-MM-SS.sqlite` for explicit pre-migration backups

On the first real CLI command each day, `kb` creates a SQLite backup and keeps the most recent 7 daily backups.
When `kb` needs to migrate an older schema, it also creates a separate pre-migration backup first.

## Safety Model

- Shared app code never discovers real storage locations on its own
- `src/cli.ts` is the only launcher that injects your real data root
- `src/test-cli.ts` injects an isolated temp root by default
- `kb --help` and invalid commands exit before opening the database

Tags are normalized to lowercase slugs, so `Full Text Search` becomes `full-text-search`.

## Development

Type-check the project:

```bash
npm run check
```
