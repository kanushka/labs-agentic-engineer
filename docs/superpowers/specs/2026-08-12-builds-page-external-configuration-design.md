# Builds Page External Configuration

## Context

Issue #442 moves external dependency value collection out of the build drawer
and onto the Builds page. It is stacked on issue #441 / PR #444, which authors
external bindings without credentials and exposes project and component-level
readiness using `not-provisioned`, `unset`, and `configured` states.

The configuration surface is project-level and non-blocking. Developers may
enter values while a run is active, after it settles, or through a shared deep
link. Build preflight remains a single call and continues to block only genuine
design faults: ambiguous or unresolved external dependencies.

## Build Flow

The Spec page keeps the current commit, preflight, and cut-version sequence.
Preflight returns the schema for external dependencies but distinguishes design
faults from non-blocking configuration items. If a design fault exists, the
existing in-place drawer and chat handoff remain. Otherwise the cut-version
confirmation starts the run with no externally supplied values and navigates to
the Builds route with `connections=open`.

The build drawer retains only panels that resolve design blockers. External
configuration fields, platform-resource information, and the rule requiring all
configuration keys to be non-empty are removed. Any grouping or conversion code
made unreachable by that removal is deleted.

## Route and Page State

The Builds route validates an optional `connections=open` search parameter and
passes it to the page. The parameter opens or focuses a stable configuration
section on the page. Because the state is encoded in the URL, it survives reload
and can be shared directly. Unknown values are discarded by route validation.

The section is project-level rather than tied to the selected version. Changing
the version picker does not change which current development values are shown.
Existing run notices and connection links target this section instead of sending
the developer back to the Spec page.

## Configuration Model and UI

The section combines two existing server-truth reads:

- the design dependency list supplies external dependency descriptions and key
  schemas;
- project external dependency readiness supplies each dependency's value state
  and missing key names.

Only `external` dependencies render. Shared dependencies are deduplicated by
their external resource name so the section contains one card per dependency.
Each card shows its name, description, schema fields, and a readiness chip.
`not-provisioned` explains that the platform still owes the resource, `unset`
explains that the developer still owes values, and `configured` reports success.

Declared defaults seed non-secret inputs and already count as supplied. Secret
keys render as password fields. Key descriptions render as field hints. Each
card owns its working values and Save action, so one dependency can be submitted
without completing any other card. A configured dependency can still be edited
because values are write-only and correcting a value must remain possible.

## Shared Field Presentation

The schema-driven field list is extracted from `ConnectionValuesDialog` into a
presentational component. It receives the key schema, current values, and a
change callback. It owns no mutation, dialog, card, or environment behavior.
The existing Deployments dialog and the new Builds cards remain separate
containers around that shared renderer.

This is the narrowest reusable seam: field semantics stay consistent without
coupling two workflows with different layout, lifecycle, and readiness needs.

## Saving and Freshness

Cards post development values through the existing external-resource values
endpoint. The values mutation owns cache invalidation for project readiness and
component dependency status. Consequently the Builds page, Spec view, and
Deployments page refresh from server truth after either call site saves values.

The Spec view continues to consume component dependency status and therefore
shows the same value state as the Builds page. The Deployments page replaces its
hardcoded configured indicator with the component dependency value state. Its
production promotion form remains otherwise unchanged and is not conflated with
development readiness.

Errors remain local to the failing read or card. A failed save leaves entered
values intact and shows an actionable error. Configuration never pauses or
cancels the active build.

## Testing

Implementation follows red-green-refactor at the existing console seams.
Focused tests cover:

- route validation and reloadable `connections=open` state;
- Build starting without a configuration drawer and navigating to the Builds
  page with the section open;
- one card per external dependency, correct text/password field types, key
  descriptions, and default-seeded values;
- readiness chips for `not-provisioned`, `unset`, and `configured`;
- independent card submission and mutation-owned readiness invalidation;
- Spec and Deployments surfaces using real component value state;
- blocker-only drawer behavior and replacement of the old link-back.

Focused test files and console typechecking run throughout. Before completion,
the full required checks run: `make deadcode-ts-check`, `make test`, `make lint`,
`make typecheck`, and `make license-check`.

## Documentation

The change adds `docs/decisions/ADR-0017-external-dependency-values-are-a-deploy-gate.md`
as the repo-wide final-state decision record. It documents the #441 readiness
and authoring contract, this console flow, and the deploy gate as the intended
consumer. Any deploy-gate behavior not present on the stacked base is described
as follow-up scope rather than claimed as shipped behavior.

## Out of Scope

- Collecting values for platform resources or organization services.
- Renaming existing symbols or removing "connection" from console copy.
- Adding environments beyond `development`.
- Changing the production promotion value model.
- Implementing the milestone deploy gate itself.
