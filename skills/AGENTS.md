# AGENTS.md — skills/

The platform's skill library, one `<name>/SKILL.md` directory per skill.
`aep-api` seeds it into each org's `org-skills` repo, which design agents
read. A coding run reads its project's `.claude/skills/` mirror: enabled
skills whose `audience` includes `coding`, plus pinned ones. The playground
reads this tree directly; a cluster picks up edits after `make dev-update`.

## How a skill reaches context

- `organization` rides every design turn; `console` rides console turns.
- A flow command inlines its skill and supporting skills
  (`FLOW_SUPPORTING_SKILLS`, `services/agents/src/prompts/turn.ts`).
- `architecture` pins stack skills in `design.json` `skillsPinned`; a pinned
  body joins the coding run's system prompt.
- `aep` (coding) and `validation-task` (validation) are always on, one per run.
- Everything else loads on demand from its `description`.

## Frontmatter

- `name` equals the directory name; a mismatch drops the skill.
- `metadata.aep.kind`: `platform` is read-only to orgs; `org`, or absent, is
  editable.
- `metadata.aep.audience`: `[design]`, `[coding]`, or absent for both.

## Who owns what

| Owner | Holds |
| --- | --- |
| a tool's `--help` | that tool's verbs and flags |
| `authorization-model` | the access invariants |
| `aep/references/component-contract.md` | what every component obeys; the one file a fan-out subagent reads |
| `aep/SKILL.md` | the coding run: git, gh, issues, PRs |
| `validation-task` | the validation run |
| a stack skill | one stack's layout, Dockerfile, libraries, verify, pitfalls |
| `organization` | org choices, including the design system; only design-system skills also name one |
| a flow skill | the artifact it writes; `grilling` and `prd-contract` are shared mechanics |
| `mock-verification` | what a walk checks; `aep` dispatches it, `agent-browser` drives the page |
| `references/` | material needed at a recognisable moment, copied byte-identical to every mode |
| `aep/overlays/local.md` | local-mode edits to `aep`; `make test` checks each anchor matches once |
