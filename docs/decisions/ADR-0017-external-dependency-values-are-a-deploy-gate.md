# ADR-0017 — External dependency values are a deploy gate, not a build gate

## Context

An external dependency's values are not needed to cut a version or write the
code that consumes it. The coding agent needs the dependency's declared
environment-variable names, but requiring every credential before Build made
unrelated coding work wait on secrets that are only used by a deployed
application. The old build drawer also held its form state locally, so it could
not survive a reload or be shared with the person who holds a credential.

OpenChoreo does not provide the value-readiness signal AEP needs. A binding may
be Ready while its external values are empty, and omitting a declared key can
make rendering fail. The controller behavior on which this distinction rests
is pinned, with upstream citations and the OpenChoreo version, in the issue
`#441` projects-package design note:
[`services/aep-api/internal/projects/design/openchoreo-resource-binding-behavior.md`](../../services/aep-api/internal/projects/design/openchoreo-resource-binding-behavior.md).

This decision spans the shipped issue `#441` authoring/readiness change and the
shipped issue `#442` Builds-page configuration change. It also defines the
boundary for a separate milestone deploy-gate change that has not shipped in
this stack.

## Decision

Missing values for an `external` dependency do not block Build. Provisioning
authors the dependency and Build starts; the developer supplies real values
from project-level configuration on the Builds page.

AEP determines external value readiness independently of OpenChoreo binding
Ready. The design's current union config schema says which keys are required,
and the binding says whether those keys have values. The resulting state is:

- `not-provisioned` when the binding does not exist;
- `unset` when any currently declared key is absent or empty;
- `configured` when every currently declared key is non-empty.

Design-resolution faults remain build blockers. An ambiguous or unresolved
external dependency, an unresolved external specification, or an organization
service that still needs resolution must be fixed before the version can be
cut. Missing external values are deliberately a different fact.

The intended enforcement point for those values is deployment: a milestone
must not deploy until its external dependencies are configured and its platform
resources are provisioned. That deploy gate is a follow-up decision boundary,
not behavior implemented by #441 or #442.

## Shipped behavior

The #441 backend change authors every external key derived from the design
during provisioning. Plain keys without defaults are present with an empty
value, declared plain defaults are seeded, and the `secretStorePath` value is
present and empty. No sentinel or pending vault entity represents an unset
value. Re-authoring merges with the existing binding so a later build preserves
non-empty values already supplied by a developer.

The project readiness read combines the current design schema with binding
state and returns the three states above, including the missing key names. The
same decoded value state is exposed on per-component dependency status. Removed
or otherwise undeclared binding keys do not affect readiness: a dependency is
configured when every key in the current design has a value, even if an empty
stale key remains on the binding.

The #442 console and preflight change keeps Build preflight as one call. Its
items still carry the external config schema, but `needsResolution` alone
decides whether the blocker-only drawer opens. When there is no design blocker,
Build sends no external credentials, cuts the version, starts the run, and
navigates to the Builds route with the validated `connections=open` search
parameter.

The resulting Builds section is project-level, deep-linkable, and independent
of the selected version or current run state. It renders one card per external
dependency from the design schema joined with project readiness. Cards expose
key descriptions, password inputs for secrets, seeded non-secret defaults, and
the distinction between platform provisioning, missing values, and configured
values. Each card saves development values independently through the existing
values endpoint. The mutation refreshes both project readiness and component
dependency status, keeping Builds, Spec, and Deployments views aligned.

The build drawer now contains only design-resolution panels. Design-resolution
faults still block and retain their in-place Spec/chat handoff. External config
fields, platform-resource information, and the rule that all external keys must
be non-empty before Build are no longer part of the drawer.

## Deploy-gate follow-up

The #441/#442 stack leaves OpenChoreo auto-deploy enabled. It does not add a
milestone deploy gate, disable auto-deploy, park a run on readiness, wake a run
after the last value is saved, or make the platform own release activation.

Those changes must ship together. With auto-deploy enabled, OpenChoreo can
re-pin release bindings during reconciliation; disabling it without adding the
platform-owned deploy path would stop deployment entirely. The follow-up must
therefore disable auto-deploy and add the milestone-owned readiness check,
visible waiting state, wake-up signal, and idempotent project deployment as one
coherent change.

Until that follow-up ships, the accepted interim risk is that an application
may auto-deploy to `development` with empty external configuration. The risk is
bounded to the development environment and to dependencies whose values have
not yet been supplied; it is accepted so coding can proceed without a
credential that coding does not consume.

## Consequences

- Developers can start coding immediately and can share or reload the exact
  Builds-page configuration URL while credentials are gathered.
- The coding agent receives stable environment-variable names but cannot rely
  on live third-party calls before values are configured.
- Readiness is derived rather than stored. A design-schema or binding change is
  reflected without synchronizing a second database record.
- OpenChoreo binding Ready and AEP value readiness intentionally remain
  separate facts; code must not substitute one for the other.
- An external secret with an empty remote reference may report errors in the
  secret operator between provisioning and configuration. Coding does not
  consume it, but the operator or an auto-deployed workload may observe missing
  or incomplete values; platform dashboards can show the resulting failures.
- The read-then-write merge used to preserve existing values is not atomic. A
  concurrent value save in its narrow read/write window can be lost; this is an
  accepted #441 limitation.
- A legitimately empty external value cannot be represented as configured
  because the design schema has no `required` flag. Adding that distinction
  requires a separate schema decision.
- Most importantly, this stack improves build-time collection but does not yet
  enforce deployment safety. Consumers must not describe the deploy gate as
  shipped until the follow-up lands.

## Verification

The authoring and readiness contract is covered by provisioning/readiness tests
in `services/aep-api/internal/dependencies/provisioning`. The #442 boundary is
covered by build preflight tests plus console tests for the blocker-only drawer,
non-blocking build navigation, validated deep links, card field semantics,
independent saving, cache invalidation, and shared Spec/Deployments readiness.

The repository gates for this decision are:

```text
make -C services/aep-api gen-api-check
make -C services/aep-api deadcode-check
make deadcode-ts-check
make test
make lint
make typecheck
make license-check
```

Controller behavior itself is outside the unit-test boundary. Local-stack
evidence must demonstrate no build drawer, the Builds redirect, binding keys
authored empty/defaulted, values saved while the run continues, readiness
changing to configured, and a rebuild preserving saved values. Such evidence
validates the #441/#442 behavior only; it must not be presented as evidence of
an unshipped deploy gate.
