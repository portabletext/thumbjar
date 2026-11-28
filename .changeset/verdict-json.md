---
'thumbjar': minor
---

feat: write a verdict.json for each device run

thumbjar's setup file now writes `<outDir>/verdict.json` after each test file, merging every file of the run into it: each test's project and platform, its outcome, why it ended so, the first step of its last attempt that did not end `done`, the keys and events of each step, and the files its driver calls wrote in this run. The `Verdict` type from `thumbjar` describes it.
