# Changelog

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
