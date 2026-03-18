# kb

Small CLI for saving, editing, and searching personal knowledge-base entries.
It stores entries in SQLite, keeps search fast with a local index, and stays entirely on your machine.

## Features

- Add notes with a question, tags, and a multi-line answer
- List all entries or filter by tag
- Open any entry by `#id`
- Edit entries in your terminal editor
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
kb list [--tag=tag]
kb get #id
kb edit #id
kb remove #id
kb search "query"
```

## Examples

```bash
kb
kb list
kb list --tag=sqlite
kb get #12
kb edit #12
kb search "fts tokenizer"
```

## Entry Flow

- `kb` starts a new entry prompt
- Enter the question first
- Pick existing tags or add new ones
- Type the answer across multiple lines
- Finish the answer with two blank lines
- Type `/editor` on the first answer line to switch to your editor

When editing an existing entry, `kb` opens your editor using `VISUAL`, then `EDITOR`, then `vi`.

## Storage

`kb` stores data in:

- `$XDG_DATA_HOME/kb` when `XDG_DATA_HOME` is set
- `~/.local/share/kb` otherwise

Files:

- `kb.sqlite` for entries and tags
- `search-index.json` for the search index
- `backups/kb-YYYY-MM-DD.sqlite` for daily SQLite backups

On the first real CLI command each day, `kb` creates a SQLite backup and keeps the most recent 7 daily backups.

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
