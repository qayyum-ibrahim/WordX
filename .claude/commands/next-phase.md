---
description: Build the next unfinished WordX phase from ROADMAP.md, test it, update status, commit and push
argument-hint: [optional phase number to build instead]
---
Build the next phase of WordX.

1. Read `CLAUDE.md` and `ROADMAP.md`. If `$ARGUMENTS` names a phase, use that one. Otherwise use the phase marked `next`, or the first `todo` phase.
2. Run `git status` and `git pull --ff-only`. If the tree is dirty with changes that are not yours, stop and tell the owner.
3. Tell the owner in 2-3 simple sentences which phase you are building and what it will include. If the phase needs a decision or input only the owner can give (for example Phase 7 needs expected daily players), ask for it first, then continue.
4. Make a short task list. Build the phase in small steps. Follow every rule in `CLAUDE.md` (both stores, tests, env vars in `render.yaml` and README, phone-size browser check for UI).
5. Run `npm test`. Fix failures. Do not skip or weaken tests. If something cannot be tested here (real MongoDB, real Google, real ads platform), say so clearly.
6. Update `ROADMAP.md` in the same change: mark the phase `done`, mark the following phase `next`, add any new owner to-do items, add a change-log line with today's date. Update the README if setup changed.
7. Commit with a clear message and push to `main`.
8. Report in simple language: what was built, what was tested, what is untested or uncertain, what the owner must do by hand, and what `/next-phase` will build next.
