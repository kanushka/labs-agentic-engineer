# ADR-0017 — External dependency values are a deploy gate

An external dependency can be structurally provisioned in OpenChoreo while its
user-supplied values are still empty. OpenChoreo correctly reports that binding
Ready because the external ResourceType's rendered object needs no operator;
that condition says the binding rendered, not that AEP has the credentials or
endpoints needed by the workload.

## Decision

External dependency configuration is a milestone-run deploy gate, not a build
gate and not an OpenChoreo Ready condition.

- Component builds proceed while external values are absent. This lets the
  platform produce and validate build artifacts without secrets.
- After all component builds are green, the supervisor re-derives deployment
  readiness from the current design. Platform resources must have Ready
  bindings; external dependencies must have all declared values configured.
- Missing external values put the run in `waiting` with a persisted reason and
  the blocking dependency names. Saving values signals the active project run;
  a periodic re-check remains the lost-signal backstop.
- Components use `autoDeploy: false`. A single retried Temporal activity pins
  releases Active and runs deploy-time convergence hooks only after the gate is
  ready.
- Cancellation while parked ends the run without invoking deployment.

Readiness is derived, never stored as a second truth. The persisted waiting
detail exists only to explain the live workflow state to API and console
readers; leaving the gate clears it.

## Consequences

Builds no longer expose workloads with empty external configuration, and a
protected API's managed gateway policy is part of the same retry unit as its
release activation. A run can wait indefinitely for human input, but the Build
story names each dependency and links directly to its configuration surface.
