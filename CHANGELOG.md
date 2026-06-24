# Changelog

## [0.13.0](https://github.com/drewpayment/mink/compare/v0.12.0...v0.13.0) (2026-06-24)


### Features

* **compression:** enable tool-output compression by default ([20698be](https://github.com/drewpayment/mink/commit/20698be99e78c4a48f0990cd00a888bf52332a5d))
* **compression:** phase 1 measurement foundation for tool-output compression ([446024f](https://github.com/drewpayment/mink/commit/446024fe4bd8479350a0597e443502cbd29bc296))
* **compression:** phase 2a — reversible cache + mink retrieve ([de03d36](https://github.com/drewpayment/mink/commit/de03d366532e9e3d9f808fcfd0bbd030f70fa3f4))
* **compression:** phase 2b — deterministic content-aware compression engine ([536811a](https://github.com/drewpayment/mink/commit/536811a435a38c1c1f0677eaffcff3a572705a09))
* **compression:** phase 2c — wire inline tool-output compression into hooks ([445a0a6](https://github.com/drewpayment/mink/commit/445a0a63e5dc51a3a27564de84a9b2b3107b004a))
* **compression:** phase 3 — structural code skeletons + recursive JSON crush ([0843669](https://github.com/drewpayment/mink/commit/08436699a88a6c765b762e34f1d1e759ae9a52b6))
* **compression:** surface measured compression in dashboard, status & ledger ([18a3404](https://github.com/drewpayment/mink/commit/18a34046deace9b855c50b38367141092077d3ab))
* **dashboard:** unify token + compression savings into one Overview ([0982d30](https://github.com/drewpayment/mink/commit/0982d30245aad661b325c23d5d3395e20dd7c0a7))
* **pi:** make tool-output compression work under the Pi adapter ([7a57e7f](https://github.com/drewpayment/mink/commit/7a57e7faf32482afa7900a89fd1daeef9eef12e6))
* tool-output compression (spec 21) ([519d254](https://github.com/drewpayment/mink/commit/519d254c15a6fd6b13ffead1df52965ad49a73b1))
* **upgrade:** auto-refresh hook wiring after upgrade (no manual re-init) ([229a4e2](https://github.com/drewpayment/mink/commit/229a4e2455707195198676e723182d0dc96c1537))

## [0.12.0](https://github.com/drewpayment/mink/compare/v0.11.0...v0.12.0) (2026-06-05)


### Features

* **bin:** collapse mink-bun into a runtime-selecting mink shim ([75c88ea](https://github.com/drewpayment/mink/commit/75c88ea8447e90df3442aa210147faf7b089ee57))
* **cli:** show runtime and bundle in --version output ([72671cf](https://github.com/drewpayment/mink/commit/72671cf67295e9d65427da5f50461cc2bdfb3c48))
* **scanner:** incremental scan + content-hash skip-re-extract (Phase 5) ([eab05b1](https://github.com/drewpayment/mink/commit/eab05b1e9693626df16d29e2de4622d93b73f652))
* **storage:** add SQLite storage layer with dual-runtime build (Phase 1) ([ea14ba0](https://github.com/drewpayment/mink/commit/ea14ba09b3d10dd1a46101b65178a17deef3a227))
* **storage:** SQLite-backed file index, bug memory, and token ledger (0.12.0) ([e37c972](https://github.com/drewpayment/mink/commit/e37c972d38febf0e928095176c57eeebaebb3d80))
* **storage:** swap bug memory to SQLite + FTS5 (Phase 3) ([82b56e8](https://github.com/drewpayment/mink/commit/82b56e847de4c6c3438f2ad1f20f0f9487027907))
* **storage:** swap file index to SQLite repository (Phase 2) ([efffd4c](https://github.com/drewpayment/mink/commit/efffd4c63273b18bec1d75784ded9ecccf56314f))
* **storage:** swap token ledger to SQLite (Phase 4) ([0e2613e](https://github.com/drewpayment/mink/commit/0e2613e02c041716d8175af6cfb0fffdf8c3af01))


### Bug Fixes

* **dashboard:** allow `mink dashboard` from any directory ([792c81d](https://github.com/drewpayment/mink/commit/792c81d39cee10a86ec3399d6c0c793d390063fe))
* **init:** resolve CLI path to the bin shim from any dist bundle ([e45e567](https://github.com/drewpayment/mink/commit/e45e567f61c0da352d8285d29499f1506e160451))
* **post-read:** repair token-savings measurement and lazy index seeding ([e86e5dd](https://github.com/drewpayment/mink/commit/e86e5dd42218f59c4706f443f13d56ddb5040669))
* **prompt-cache:** move volatile fields to footer in generated markdown ([7284be0](https://github.com/drewpayment/mink/commit/7284be026b7553453d06e7b1eff5aef416aa9316))
* **status:** report sharded action-log and learning-memory as ok ([b3f01bb](https://github.com/drewpayment/mink/commit/b3f01bb814fc34e9ee884e058a1fcfb1dcc9d165))
* **status:** report sharded action-log and learning-memory as ok ([94a3109](https://github.com/drewpayment/mink/commit/94a3109222a362a532bae991882aeaa746cc28ea))
* **sync:** atomic db-merge replace, pin Node floor, document sync-size cost ([126b2dd](https://github.com/drewpayment/mink/commit/126b2ddf8607457caae15f220de639266b3fea2d))

## [0.11.0](https://github.com/drewpayment/mink/compare/v0.10.1...v0.11.0) (2026-05-18)


### Features

* **identity:** add safety mechanisms — dry-run, backup, rollback ([4e1f552](https://github.com/drewpayment/mink/commit/4e1f552a08d398f1b69667090608ca568e76190f))
* **identity:** implement spec 20 — stable project identity ([eaa6a7b](https://github.com/drewpayment/mink/commit/eaa6a7b140198e9634005017dc954fd4ed634e0b))
* **identity:** spec 20 + implementation — stable project identity (closes [#72](https://github.com/drewpayment/mink/issues/72)) ([9cf3a79](https://github.com/drewpayment/mink/commit/9cf3a79a99e62d714e258db4aaadd6621aff5de1))


### Bug Fixes

* **identity:** evict converged old dirs and make planner idempotent ([ef8a210](https://github.com/drewpayment/mink/commit/ef8a210ce42054a7733da4a36c42801e8642d937))
* **identity:** repair missing new-dir meta on converge ([6a7b49f](https://github.com/drewpayment/mink/commit/6a7b49f8270d6e5f1d4d45a66ac3f9503df89db6))
* **identity:** snapshot identity flag before stash window ([ba944f2](https://github.com/drewpayment/mink/commit/ba944f2afc807a8448a5cc8821daca9f244c6095))

## [0.10.1](https://github.com/drewpayment/mink/compare/v0.10.0...v0.10.1) (2026-05-09)


### Bug Fixes

* **index:** surface scan cap and detect stale vault index ([309545f](https://github.com/drewpayment/mink/commit/309545f1fd0db48b326255794a3cc9b6a969116d))
* **index:** surface scan cap and detect stale vault index ([4e052d8](https://github.com/drewpayment/mink/commit/4e052d8e2a1aee62ff460ebd14308ecd7eaeefb0))

## [0.10.0](https://github.com/drewpayment/mink/compare/v0.9.1...v0.10.0) (2026-05-05)


### Features

* **cli:** add mink upgrade and scheduled self-update ([#65](https://github.com/drewpayment/mink/issues/65)) ([a0156f5](https://github.com/drewpayment/mink/commit/a0156f5d803f456a9d5bdcf2f563cb0bc9431c90))
* **cli:** self-update via mink upgrade + scheduled task ([73b3a1e](https://github.com/drewpayment/mink/commit/73b3a1e592b6a40c9c0da003855d38e7f7aa98d5))

## [0.9.1](https://github.com/drewpayment/mink/compare/v0.9.0...v0.9.1) (2026-04-29)


### Bug Fixes

* **init:** emit `mink` bin shim in hook commands for portability ([735ef64](https://github.com/drewpayment/mink/commit/735ef64504e41704a60d876fae6422b6a3c559db))
* **init:** emit `mink` bin shim in hook commands instead of absolute cli.js path ([2391ac5](https://github.com/drewpayment/mink/commit/2391ac57608581fb583c48275225d839511dde64)), closes [#55](https://github.com/drewpayment/mink/issues/55)

## [0.9.0](https://github.com/drewpayment/mink/compare/v0.8.0...v0.9.0) (2026-04-28)


### Features

* **sync:** zero-intervention cross-device conflict resolution (v2) ([6c826af](https://github.com/drewpayment/mink/commit/6c826af73bfcd980a96aa3fff1a19e3ca3a0d8f3))


### Bug Fixes

* **sync:** migration resumes across budget cuts and skips done projects ([2c749b8](https://github.com/drewpayment/mink/commit/2c749b8a32e7efa814e41179905f0dd77030b994))

## [0.8.0](https://github.com/drewpayment/mink/compare/v0.7.0...v0.8.0) (2026-04-26)


### Features

* **init:** write .claude/rules/mink.md during mink init ([564dcff](https://github.com/drewpayment/mink/commit/564dcff7d11dc03bbc273a0438c2a888fce7ccff))
* **init:** write .claude/rules/mink.md so the project tells Claude it uses Mink ([1f82577](https://github.com/drewpayment/mink/commit/1f82577a173f36a4845a75a47033e1a719e6c0e6))

## [0.7.0](https://github.com/drewpayment/mink/compare/v0.6.1...v0.7.0) (2026-04-25)


### Features

* **agent:** add `mink agent` command with bundled persona ([2b749d7](https://github.com/drewpayment/mink/commit/2b749d756e075d4d0740e1c43b88c76ccbef53d4))
* **agent:** add `mink agent` command with bundled persona ([3c9bfe6](https://github.com/drewpayment/mink/commit/3c9bfe6eb70627197904c69f5843a8bfe3b469ef))
* **daemon:** add `install` / `uninstall` subcommands (systemd, launchd) ([7c7c048](https://github.com/drewpayment/mink/commit/7c7c048d3811ab3f2869ceff1fa459548dda1a4b))
* **daemon:** add `install` / `uninstall` subcommands for systemd and launchd ([09ff7de](https://github.com/drewpayment/mink/commit/09ff7de27ba8a8999af6ac215f352c58604d3e33))

## [0.6.1](https://github.com/drewpayment/mink/compare/v0.6.0...v0.6.1) (2026-04-21)


### Bug Fixes

* **cli:** resolve skills dir from package root, not relative depth ([1f20fd4](https://github.com/drewpayment/mink/commit/1f20fd4072b52cf05002d8beee4b4a83c6f03b1e))
* **cli:** resolve skills dir from package root, not relative depth ([5a4d8a6](https://github.com/drewpayment/mink/commit/5a4d8a6a6a7639fd8de3989f77438d5a166152ea))

## [0.6.0](https://github.com/drewpayment/mink/compare/v0.5.1...v0.6.0) (2026-04-20)


### Features

* **dashboard:** chrome for the command-center GUI ([cbfc80d](https://github.com/drewpayment/mink/commit/cbfc80dfec3810238bfce79c6c20a45ea2d0fbea))
* **dashboard:** preview panels — wiki, capture, discord, sync, daemon, config ([d0b6071](https://github.com/drewpayment/mink/commit/d0b607176086c37ecb745afd4ed0ca4c78db4344))
* **dashboard:** rebuild as command-center GUI ([e933e0b](https://github.com/drewpayment/mink/commit/e933e0bf9c8cca7205e0c776b7574c6ce09a4cde))
* **dashboard:** rewrite real-data panels in the new visual grammar ([e7a7b01](https://github.com/drewpayment/mink/commit/e7a7b015b9ecd5af921d74967dbab175e3b1aada))
* **dashboard:** wire capture panel to note-writer + delete mock data layer ([0170847](https://github.com/drewpayment/mink/commit/0170847be287b5da8a7c6452a727809e3d6011f3))
* **dashboard:** wire channel panel to channel-process start/stop/restart ([9243784](https://github.com/drewpayment/mink/commit/92437848cd362e0f01707f18f688c852eb034d7b))
* **dashboard:** wire config panel to resolveAllConfig with live writes ([8b6e408](https://github.com/drewpayment/mink/commit/8b6e408f56af0e2083c7b14ac1eac6cf7adb28f3))
* **dashboard:** wire daemon panel to real start/stop/restart endpoints ([c3f31a3](https://github.com/drewpayment/mink/commit/c3f31a3c3603cedbde554cbd68b71326370ad00f))
* **dashboard:** wire daemon panel to real start/stop/restart endpoints ([62a19cb](https://github.com/drewpayment/mink/commit/62a19cb2cc0365d52f2483eb6f0fb773704d736b))
* **dashboard:** wire sync panel to getSyncStatus with pull/push/disconnect ([3baaf99](https://github.com/drewpayment/mink/commit/3baaf99788b1817722e5b5062dd46d5d836f9f82))
* **dashboard:** wire wiki vault to real read endpoints (panel + capture tags) ([ff57a3b](https://github.com/drewpayment/mink/commit/ff57a3b3e5e30363ffab0babb56828dc21496a00))


### Bug Fixes

* **cli:** make daemon + vault path usable from the installed Node bundle ([ab38e00](https://github.com/drewpayment/mink/commit/ab38e002da5f10d49bd0ba9fcb21e84515029225))
* **dashboard:** stabilize capture-panel tags selector to avoid zustand infinite loop ([670fa11](https://github.com/drewpayment/mink/commit/670fa115f3027a74b2223028c0da3037aa0d1dd2))

## [0.5.1](https://github.com/drewpayment/mink/compare/v0.5.0...v0.5.1) (2026-04-18)


### Bug Fixes

* ship built dashboard assets in npm tarball ([9984873](https://github.com/drewpayment/mink/commit/998487309679c17375684f9729bd786996659804))
* ship built dashboard assets in npm tarball ([0996eab](https://github.com/drewpayment/mink/commit/0996eabb326989b98eb1e60cc6f277ef7099b397))

## [0.5.0](https://github.com/drewpayment/mink/compare/v0.4.0...v0.5.0) (2026-04-17)


### Features

* add discord channel companion via claude code channels ([659ba26](https://github.com/drewpayment/mink/commit/659ba268e6bb35b94f6df2976c843c33204232a0))
* Discord channel companion via Claude Code Channels ([c64f3a4](https://github.com/drewpayment/mink/commit/c64f3a4d6012f3a7ac03e7ba30357535b27f374b))


### Bug Fixes

* **channel:** advertise screen-256color to avoid washed-out colors ([48e20a0](https://github.com/drewpayment/mink/commit/48e20a0d325f77cb04459d88b588e469a88b3a8a))

## [0.4.0](https://github.com/drewpayment/mink/compare/v0.3.0...v0.4.0) (2026-04-16)


### Features

* per-machine config with device identity ([8906faf](https://github.com/drewpayment/mink/commit/8906fafdcf79c9b9451640f9af3bc21575779b5d))
* per-machine config with device identity and scoped settings ([0a367bc](https://github.com/drewpayment/mink/commit/0a367bcd054a577d1266beb4a8474afe672e1581))

## [0.3.0](https://github.com/drewpayment/mink/compare/v0.2.2...v0.3.0) (2026-04-14)


### Features

* add `mink wiki link` to symlink external notes into the vault ([c805019](https://github.com/drewpayment/mink/commit/c80501949c8066c0e0f97d212ef23bb1fe148c85))
* add mink sync for cross-device ~/.mink git backup ([#28](https://github.com/drewpayment/mink/issues/28)) ([bab88b2](https://github.com/drewpayment/mink/commit/bab88b2de7e6c200ebd6a5383690a214bd4c9270))

## [0.2.2](https://github.com/drewpayment/mink/compare/v0.2.1...v0.2.2) (2026-04-13)


### Bug Fixes

* include dashboard static assets in npm package ([de89170](https://github.com/drewpayment/mink/commit/de89170df25d8edba91506358cfd83982119ac5b))
* include dashboard static assets in npm package ([780f1f2](https://github.com/drewpayment/mink/commit/780f1f25c5534f81386bffd89628751688afef40)), closes [#23](https://github.com/drewpayment/mink/issues/23)

## [0.2.1](https://github.com/drewpayment/mink/compare/v0.2.0...v0.2.1) (2026-04-13)


### Bug Fixes

* make dashboard server work under both Node.js and Bun ([3036f98](https://github.com/drewpayment/mink/commit/3036f987608884f64d4feb35d5fe9d3b6f3f1c21))
* make dashboard server work under both Node.js and Bun ([15902de](https://github.com/drewpayment/mink/commit/15902de693898be6a416b2e04f413968956c3803)), closes [#23](https://github.com/drewpayment/mink/issues/23)
* resolve type errors and update dashboard tests for async server ([c92bef1](https://github.com/drewpayment/mink/commit/c92bef180fe9f99d9cd4d58a7f7061133b67c8e5))

## [0.2.0](https://github.com/drewpayment/mink/compare/v0.1.0...v0.2.0) (2026-04-13)


### Features

* add notes/wiki vault and Claude Code skill for intelligent note capture ([346a6dc](https://github.com/drewpayment/mink/commit/346a6dc39ab5ad0384a5e813a6c9adc3459527c8))
* make mink-note skill compatible with skills CLI ecosystem ([78301a8](https://github.com/drewpayment/mink/commit/78301a8f12498383061caeb912c1848b2c7a659b))
* notes/wiki vault with Claude Code skill ([472fdb0](https://github.com/drewpayment/mink/commit/472fdb0d6bc5a6a5736227d47727b86a56908f09))


### Bug Fixes

* compile CLI to JS so hooks work with both Node.js and Bun ([5c8436a](https://github.com/drewpayment/mink/commit/5c8436aea5b4c4fae2408846a4e7ae6a2bbc65b1))
* create ~/.claude/skills/ symlink on mink skill install ([4d900a6](https://github.com/drewpayment/mink/commit/4d900a634f22cc886e4c6e1680d79afeafa6b552))
