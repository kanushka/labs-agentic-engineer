---
name: writing-skills
description: "Use before changing anything under skills/ or .agents/skills/, or any AGENTS.md."
---

A change to these files starts as a proposal: a Claude Doc (an HTML
artifact where the docs connector is absent; a one- or two-line change can go
in chat). The agent then makes the change and runs the verify loop, and the
doc records what it did. The user reviews the doc and the diff before anything
is committed.

## Artifact Format
  
- **Evidence**: what shows the need: a failing run or issue for a fix, size or duplication for an optimisation, a gap no skill owns for a new skill.
- **Change**: files, before and after.
- **Placement**: why this skill owns the change and where in the exact skill it belongs to address the root problem. For a new skill, why no existing skill owns it; for a root cause outside the skills (a tool's `--help`, agent code), where it is.
- **Changelog**: Log of the Changes you did, Eval results during each iteration verification loop.

## Verify Loop

1. For a change under `skills/`, run the playground before editing (Use sonnet subagent; how to run: `playground/AGENTS.md`): reproduce the failure for a fix, record the behaviour to keep for an optimisation, show the gap for a new skill. The playground never deploys, so skip for `validation-task` and anything that needs a live deployment. You'll need a live run in cluster.
2. Make skill changes as you think is the best solution to the problem.
3. Rerun the playground and compare the result and tool call logs against step 1. For a new skill, check the agent loads it from its description at the right moment.
4. Critique the change against the statement rules and iterate until all good. 
5. Make sure to keep iteration logs in the artifact.

## Skill Statement Rules

- A skill should contain information so that agent can make decisions based on that.
- The name and description is the one that the agent uses to invoke the skill. Clearly tell what the skill does so agent knows when to use it. Be extremely concise.
- Each fact has one owner and an area.
- `metadata.aep.audience` decides who reads a skill: design agents, coding runs, or both (absent); a fact belongs in a skill its reader loads.
- A rule's history belongs to git or an ADR, not the skill.
- Focus on the maintainability of the skill, Group things that are related.
- Use references for content that can be retrieved when needed instead of embedding it in the skill.
- Avoid patching the skill for the issues you've faced, it should find the root cause and address there.
