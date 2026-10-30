# dsh-lore-memory

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that gives the agent two kinds of persistent notes, kept per workspace. The design is in [RFC 0001](docs/rfcs/rfc-0001.md).

- **Lore**: rules you want followed in a workspace, such as "use pnpm, never npm". Lore changes only when you ask. The model gets the current lore every turn.
- **Memory**: knowledge the agent keeps for itself (constraints, conventions, decisions, procedures, facts). The agent curates it freely. The model gets it once, when an agent starts.

Both are searchable, in Chinese as well as English (jieba segmentation plus pinyin). macOS only.

## Install

```sh
git clone https://github.com/rn7s2/dsh-lore-memory.git
```

Then ask the agent in DSH to install the bundle from that directory (Plugin Manager → `install_bundle` with the absolute path). The package ships its built `lib/` and the vendored tokenizer, so it has no install scripts and no runtime dependencies.

## Scopes

An entry belongs to the workspace folder it was written in. A session sees the entries of its own workspace and of every parent folder, matched on whole path components: `/work/acme` sees `/work`, while `/work/acme-other` does not see `/work/acme`. A session writes only to its own workspace, and entries from parent workspaces are read-only from below. Workspaces are identified by their real path (symlinks resolved). A subagent reads and writes its parent session's workspace.

## How notes reach the model

- **Memory** is rendered into the system prompt (`<workspace-memory>`) when an agent's prompt is first built, and stays unchanged for that session. It survives compaction and resume. Memory added later is found with the `memory` tool.
- **Lore** is inserted as a fresh `<workspace-lore>` message at the start of every turn, just before that turn's new input. Earlier copies stay in place, so the prompt cache stays valid. Lore added by another session shows up at the next turn. When the last rule is removed, one turn announces that the earlier rules are withdrawn.

Both are grouped by scope, nearest first.

## Tools

| tool | actions | approval |
|---|---|---|
| `lore` | `query`, `add`, `edit`, `remove` | every change asks you through the host's approval prompt; under a "never ask" policy the agent cannot change lore |
| `memory` | `query`, `add`, `update`, `remove`; every entry has a `kind` | none |

`query` with search terms returns entries matching **any** term, ranked by `bm25`, so entries matching more terms, and rarer ones, come first. Prefix matches (`test` finds `testing`) and pinyin (`zhoujielun` finds `周杰伦`) are intended. Without terms, `query` lists every visible entry, nearest scope first. Results are presented as reference knowledge, and each one shows its scope.

## Commands

| command | without argument | with argument |
|---|---|---|
| `/lore` | list visible lore | add the text as lore in this workspace (no approval: you typed it) |
| `/memory` | list visible memory | ask the agent to update this workspace's memory accordingly |

`/lore` only adds. To edit or remove lore, ask the agent and approve the change.

## Configuration

```yaml
- id: lore-memory
  name: dsh-lore-memory
  config:
    dbPath: ~/.dsh/lore-memory.db   # default; shared by every DSH profile
    searchLimitDefault: 8           # results when a query gives no limit (1-100)
```

## Storage and failures

There is one SQLite database (WAL mode) per machine, holding the entries and an FTS5 index that triggers keep in step with every write. Several DSH processes can use it at once. A write that finds the database locked retries without blocking the host, and fails with "busy, try again" after about 5 seconds.

Failures are reported and never break the session:

- **Tokenizer missing or tampered with**: every vendored file is checked against a pinned SHA-256 before it is loaded. If one fails, the store becomes read-only: listing and injection still work, while search and writes fail with the reason.
- **Database unavailable**: the tools and commands fail with the reason, and nothing is injected.
- **Changing an entry from a parent workspace**: refused, and the message names the workspace to open instead.

## Development

```sh
pnpm install
pnpm run check   # typecheck, tests, build, and verify the committed lib/ is fresh
```

The sources are in `src/`, and `lib/index.js` is the committed esbuild output. The tests use temporary databases only.

`native/simple/` vendors the unmodified macOS binaries and dictionary of [wangfenjin/simple](https://github.com/wangfenjin/simple) v0.7.1 (MIT, see `native/simple/LICENSE`). Their hashes are pinned in `src/tokenizer.ts`.

## License

MIT
