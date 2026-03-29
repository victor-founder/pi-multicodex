## [2.1.2](https://github.com/victor-software-house/pi-multicodex/compare/v2.1.1...v2.1.2) (2026-03-29)


### Bug Fixes

* lowercase account manager key hints ([ed52681](https://github.com/victor-software-house/pi-multicodex/commit/ed5268151433e5a4bdb3430086a9f92b56aed3f9))

## [2.1.1](https://github.com/victor-software-house/pi-multicodex/compare/v2.1.0...v2.1.1) (2026-03-29)


### Bug Fixes

* warn when auth failures are skipped during rotation ([d42590e](https://github.com/victor-software-house/pi-multicodex/commit/d42590ee1b60a17ab635e8f90b28d6219c096ee9))

# [2.1.0](https://github.com/victor-software-house/pi-multicodex/compare/v2.0.13...v2.1.0) (2026-03-29)


### Features

* merge multicodex account management flows ([9c17670](https://github.com/victor-software-house/pi-multicodex/commit/9c17670028e371a4cc278227946400584f962e85))

## Unreleased

### Features

* merge account inspection and account actions into `/multicodex accounts`, with explicit refresh and re-authentication flows

### Bug Fixes

* skip auth-broken accounts during rotation before a request starts
* merge duplicate imported credentials into existing managed accounts without changing the active account

## [2.0.13](https://github.com/victor-software-house/pi-multicodex/compare/v2.0.12...v2.0.13) (2026-03-28)


### Bug Fixes

* provide real JWT as provider apiKey instead of placeholder string ([a88850d](https://github.com/victor-software-house/pi-multicodex/commit/a88850d4ae4fe43577500240927ced3ca841e390))

## [2.0.12](https://github.com/victor-software-house/pi-multicodex/compare/v2.0.11...v2.0.12) (2026-03-28)


### Bug Fixes

* sync active account tokens to auth.json for pi background features ([bdd3835](https://github.com/victor-software-house/pi-multicodex/commit/bdd38354c9d9d173f2a50bb8173fa483fee1cd78))

## [2.0.11](https://github.com/victor-software-house/pi-multicodex/compare/v2.0.10...v2.0.11) (2026-03-28)


### Bug Fixes

* sync active account tokens to auth.json for pi background features ([ee917bf](https://github.com/victor-software-house/pi-multicodex/commit/ee917bf3cdc8ca586640c0f0f4f2e9254692b060))

## [2.0.10](https://github.com/victor-software-house/pi-multicodex/compare/v2.0.9...v2.0.10) (2026-03-28)


### Bug Fixes

* skip accounts with burned tokens and notify user to re-authenticate ([5171896](https://github.com/victor-software-house/pi-multicodex/commit/51718960e248fa6fc8f0c88e74dec83ac4c14cd6))

## [2.0.9](https://github.com/victor-software-house/pi-multicodex/compare/v2.0.8...v2.0.9) (2026-03-27)


### Bug Fixes

* delegate imported account refresh to AuthStorage to prevent race with pi ([7b287b1](https://github.com/victor-software-house/pi-multicodex/commit/7b287b1f4f738edd1a295acd85964495046a31a6))

## [2.0.8](https://github.com/victor-software-house/pi-multicodex/compare/v2.0.7...v2.0.8) (2026-03-27)


### Bug Fixes

* deduplicate concurrent token refreshes and bump pi deps to 0.63.1 ([2a4b49e](https://github.com/victor-software-house/pi-multicodex/commit/2a4b49e0a61d2f22a546fbef78421fdbbdbf1a19))
* publish pi-provider-utils and wire up real npm dependency ([7abbfcb](https://github.com/victor-software-house/pi-multicodex/commit/7abbfcb614189f182c0109ee8347986aeee0fc2b))

## [2.0.7](https://github.com/victor-software-house/pi-multicodex/compare/v2.0.6...v2.0.7) (2026-03-16)


### Bug Fixes

* update asset paths after screenshots folder removal ([92ac386](https://github.com/victor-software-house/pi-multicodex/commit/92ac386bf8328135613aed284c958e297b116764))

## [2.0.6](https://github.com/victor-software-house/pi-multicodex/compare/v2.0.5...v2.0.6) (2026-03-15)


### Bug Fixes

* document severity-based footer color tiers ([ab9f8ce](https://github.com/victor-software-house/pi-multicodex/commit/ab9f8cec0a7a73db992ff4f4c9a0ce007abdda13))

## [2.0.5](https://github.com/victor-software-house/pi-multicodex/compare/v2.0.4...v2.0.5) (2026-03-15)


### Bug Fixes

* add prior art comparison with original repos ([14f0d91](https://github.com/victor-software-house/pi-multicodex/commit/14f0d91f6d9e49452969decd13cc5a773192e864))

## [2.0.4](https://github.com/victor-software-house/pi-multicodex/compare/v2.0.3...v2.0.4) (2026-03-15)


### Bug Fixes

* correct rotation logic description in README ([12a9533](https://github.com/victor-software-house/pi-multicodex/commit/12a953378edb4202a62f699779657ff70ad1e3a1))

## [2.0.3](https://github.com/victor-software-house/pi-multicodex/compare/v2.0.2...v2.0.3) (2026-03-15)


### Bug Fixes

* update repo references after org transfer ([2fd37e3](https://github.com/victor-software-house/pi-multicodex/commit/2fd37e365c4c00f54c63c37c3ab22610021823b1))

## [2.0.2](https://github.com/victor-software-house/pi-multicodex/compare/v2.0.1...v2.0.2) (2026-03-15)

### Bug Fixes

* correct pi repository link in README ([0e31607](https://github.com/victor-software-house/pi-multicodex/commit/0e31607351aea755f5be018d1175349f05a3478f))

## [2.0.1](https://github.com/victor-software-house/pi-multicodex/compare/v2.0.0...v2.0.1) (2026-03-15)

### Bug Fixes

* trigger patch release for updated screenshot assets ([83c1008](https://github.com/victor-software-house/pi-multicodex/commit/83c10080539239898413f7f934fcd9fe4ee4e981))

# Changelog

All notable changes to this project are documented in this file.

# [2.0.0](https://github.com/victor-software-house/pi-multicodex/compare/v1.1.0...v2.0.0) (2026-03-15)

* feat!: migrate to /multicodex command family ([cd26f76](https://github.com/victor-software-house/pi-multicodex/commit/cd26f76aff311a5b436e45b72d437d3a0e58a7ca))

### BREAKING CHANGES

* removed old multicodex top-level commands; use /multicodex subcommands.

# [1.1.0](https://github.com/victor-software-house/pi-multicodex/compare/v1.0.11...v1.1.0) (2026-03-15)

### Features

* add backspace account removal in account picker ([024ab34](https://github.com/victor-software-house/pi-multicodex/commit/024ab34c2a5e9a12bbd60fa8e2ab5f13fa6ab1e9))
