# pg-ddl-publish

Node.js CLI that compares a folder of SQL files to PostgreSQL and generates a publication script.

Spanish documentation: [README.md](README.md).

## What it does

- Takes a root folder of `.sql` files.
- Runs `pre_script` first (if present).
- Rebuilds the desired state in a **scratch** database.
- Compares **target vs scratch** with `@pgkit/migra`.
- Writes a publication SQL file.
- Can apply the publication on the target and then run `post_script`.

## Requirements

- Node.js 18+
- PostgreSQL reachable from your machine
- Two connections:
  - **target**: database to compare / publish to
  - **scratch**: temporary database to rebuild the desired state

## Install

```bash
npm install
```

## Expected layout (example)

```text
my-ddl-folder/
  pre_script/
    extension.unaccent.sql
  functions/
  tables/
  sequences/
  post_script/
    001_fix_post.sql
```

## Configuration

If `ddl-publish.config.json` is missing, the tool falls back to `ddl-publish.config.example.json` in the same directory (and prints a notice).

Copy the example to `ddl-publish.config.json` and adjust for your environment. Environment variables: `DDL_PUBLISH_TARGET_URL`, `DDL_PUBLISH_SCRATCH_URL`, `DDL_PUBLISH_SCHEMA`, `DDL_PUBLISH_OUTPUT`.

## Commands

Replace `/absolute/path/to/my-ddl-folder` with your real DDL folder path.

**Generate:**

```bash
node src/cli.js generate -f "/absolute/path/to/my-ddl-folder" --unsafe
```

**Generate with timestamped release under the DDL folder:**

```bash
node src/cli.js generate -f "/absolute/path/to/my-ddl-folder" --unsafe --to-prod
```

**Apply generated script + post_script:**

```bash
node src/cli.js apply -f "/absolute/path/to/my-ddl-folder" -p "./out/publicacion.sql"
```

**Full flow (generate then apply):**

```bash
node src/cli.js publish -f "/absolute/path/to/my-ddl-folder" --unsafe --to-prod
```

## Tests

- `npm test` — Vitest (no real PostgreSQL required; `pg` and migra are mocked).
- `npm run test:coverage` — 100% coverage on `src/*.js` except the thin `src/cli.js` entry shim.

## License

MIT — see [LICENSE](LICENSE).
