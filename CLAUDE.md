scraper that tracks Bluesky's trusted verifier accounts, written in TypeScript for Deno

it queries a relay for repos holding `app.bsky.graph.verification` records, checks each profile's verifier
status against the appview, persists the result to `state.json`, and renders a Markdown table into `README.md`.
a GitHub Actions cron runs it daily and commits the updated state and README.

## development notes

### project management

- the project runs on Deno; CI installs it via `denoland/setup-deno`, there is no local toolchain manifest
- the daily scrape lives in `.github/workflows/scrape.yaml`, which runs the scripts under `scripts/` and commits
  `state.json` and `README.md`
- run a script with `deno run -A ./scripts/<name>.ts`
- format with `deno fmt`
- lint with `deno lint`
- typecheck with `deno check`

### code writing

#### formatting

- name new files in kebab-case
- indent with tabs (spaces allowed for diagrams in comments)
- use single quotes for strings; reserve template literals for localization (user-facing strings, error
  messages)
- add trailing commas
- order list-like constructs (arrays, object keys, union/intersection members, enum variants, imports, etc.)
  alphabetically. reserve other orderings for cases where order carries meaning — semantic precedence, an
  external spec, or similar. if you encounter an unordered list while editing nearby code, reorder it as part
  of the change; avoid drive-by reorders of unrelated lists

#### control flow and structure

- use braces for control statements, even single-line bodies
- group related code and limit variable scope with bare blocks `{ }`
- use `switch` over `if`/`else if` chains when branching on a single discriminant value
- use `if` over ternaries for complex statements
- delimit sections of larger files with `// #region <name>` and `// #endregion`
- import directly from source; barrel files (index modules that re-export) are out

#### functions and methods

- prefer arrow functions; use method shorthand for object/class methods
- make a parameter optional only when callers genuinely split between passing a value and relying on the
  default. drop unused defaults; promote always-passed params to required; split into a separate function when
  presence/absence flips behavior
- prefer an options object when the function takes a boolean flag (split into two functions if the flag
  selects between distinct behaviors), when two same-typed params could be swapped at the call site, or when
  there are already 2+ optional/defaulted params. positional is fine at any count when each param has a
  distinct type and a clear semantic order

#### types

- write code that satisfies the type system naturally; reach for `as Type` or `as const` only when TypeScript
  errors and no cleaner solution exists

#### mutation

- treat function arguments as immutable; callers expect their inputs to come back unchanged. in-place
  operations like `array.sort()` or `Object.assign(target, ...)` are fine on values the function owns —
  locals, clones, freshly constructed objects — but copy first (`array.toSorted()`, `{ ...obj, ...patch }`)
  before touching anything reachable through a parameter. the exception is a function whose documented purpose
  is to mutate its argument; the name and JSDoc should make that intent obvious

### commit workflow

we use conventional commits with these rules:

- a commit represents one logical change, split distinct changes into separate commits
- accepted types: `feat`, `fix`, `refactor`, `docs`, `chore`
  - feat
    - new additions to public API surface
  - docs
    - Markdown document changes (README.md and similar)
  - chore
    - only consists of build/tooling/dependency changes
    - only consists of tests, code comments, or JSDoc changes
    - mass-autofixes from linters and formatters
- commit type describes the substance of the change as a whole, not a category to split it by. tests written
  for a feature ship in the `feat` commit; `chore` applies when test, comment, or JSDoc work is the entire
  change
- no scopes; write `feat: ...` / `refactor: ...`, never `feat(runtime): ...`
- append `!` after the type to mark breaking changes, e.g. `feat!:` or `refactor!:`

### documentation

"documentation" here means READMEs, code comments, and commit messages.

- write in lowercase, except for proper nouns, acronyms, and 'I'. public-facing interfaces (web UI) are exempt
- comment non-trivial code only, focusing on _why_ rather than _what_
- describe the code as it currently stands, not how it changed; a reader without the diff in front of them has
  no context for "previously", "now", or "changed to". reach for history only when a past state explains a
  present constraint (e.g. a workaround for a known upstream bug)
- add JSDoc to new publicly exported functions, methods, classes, fields, and enums:
  - `@param` for parameters (no dashes after param names)
  - `@returns` for return values
  - `@throws` for exceptions when applicable
  - describe _what_, not _why_, unless the rationale affects how callers use the API (e.g. a constraint). put
    other _why_ explanations in regular code comments next to the implementation
  - keep descriptions concise but informative

### agentic coding

- `.research/` in the project root is an ephemeral workspace for experiments, analysis, and planning
  materials, and may contain cloned repositories or other reference materials that inform implementation
  decisions. create if not present. its contents are local to a single working copy and may be wiped or absent
  in any future session, so committed source code (including comments, docstrings, commit messages, READMEs,
  or other docs) must not reference paths under `.research/` or rely on its contents existing
- this document is intentionally incomplete; discover everything else by exploring the repo
- explore the code first when unsure about plans, requirements, or existing behavior. ask for clarification
  when exploration leaves the question unresolved
- when debugging, isolate the root cause before attempting fixes: add logging, reproduce the issue, narrow
  down the scope, and confirm the exact source of the problem
- subagent/subtask exploration results may be inaccurate; verify findings as needed
- read files directly rather than using subagents/subtasks as file I/O proxies
