# abap2go

An ahead-of-time (AOT) compiler for ABAP, written in TypeScript and emitting Go. It compiles ABAP from abapGit
packages into standalone native executables, which are to run at a speed comparable to Go, with no ABAP application
server and no JavaScript runtime. A database, embedded or external, is allowed.

The ABAP is parsed and syntax-checked by [abaplint](https://github.com/abaplint/abaplint). For hosting (list
processing, the console, the build layout, later the database, LUW and locks) the design follows
[open-steamgate](https://github.com/oisee/open-steamgate).

Status: first steps. Small programs compile, as a report or as an `if_oo_adt_classrun` console class: elementary
`DATA`, moves, arithmetic, `strlen( )` and offset/length access, `IF`, `CASE`, `DO` and `WHILE`, `TRY`, `ASSERT`,
`WRITE` and `out->write( )`, each in the forms listed in [docs/compiler_roadmap.md](docs/compiler_roadmap.md). Every
other construct is refused at build time.

## Motivation

We want ABAP to run as a native program, without changing what it does:

- no ABAP application server and no JavaScript runtime: the result of a build is one executable;
- speed from execution, not from a changed language: only what the program can reach is compiled, into typed native
  code, and no language features, checks or security layers are added;
- no new bugs from compiling ahead of time: for every program, the compiler either refuses at build time, naming what
  it cannot compile faithfully, or produces an executable that behaves exactly as SAP would run the program. The few
  exceptions are decided one by one and listed in [docs/aot_for_abap.md](docs/aot_for_abap.md).

The design follows from this:

- **Classic modern ABAP is the reference:** the current on-premise language, 7.40 and later. ABAP Cloud is not a
  target.
- **A closed world for code, an open world for data types.** Classes, function modules and programs are compiled only
  when the source names them statically. Dictionary types requested at run time are to be looked up and handled through
  RTTI, as on SAP.
- **One root per compilation.** An entry point (an HTTP handler, an RFC module, a report) and only what it reaches
  becomes one binary.

## What is in the repository

- `src/` - the compiler
- `runtime/go/` - the Go runtime of compiled programs: ABAP's types, conversion, calculation and comparison rules and
  output formatting
- `lib/` - the abapGit package that is part of every build: the interfaces a root implements and the exception classes
  the runtime raises
- `examples/` - a report and a console class
- `test/` - end-to-end tests that build and run small programs
- `patches/`, `scripts/` - the abaplint fixes that are not released yet, and the script that collects them
- `docs/` - design, specification and status:
  - [aot_for_abap.md](docs/aot_for_abap.md): the design, its guiding principle and its decisions
  - [compiler_roadmap.md](docs/compiler_roadmap.md): the critical path (the specification of ABAP's conversion,
    comparison and calculation rules) and the compiler's status
  - [spec/](docs/spec/): the rules for [conversion](docs/spec/conversion.md),
    [calculation](docs/spec/calculation.md), [comparison](docs/spec/comparison.md) and [`WRITE`](docs/spec/write.md)
  - [abaplint_roadmap.md](docs/abaplint_roadmap.md): the work in abaplint, a line of its own
  - [open-abap-roadmap.md](docs/open-abap-roadmap.md): the work items in open-abap-core
  - [open-steamgate-notes.md](docs/open-steamgate-notes.md): measurements of open-steamgate's Go backend, the closest
    prior art

## Getting started

1. Install [Node.js](https://nodejs.org) and [Go](https://go.dev) 1.24 or later.
2. Run `npm install`.
3. Build and run the examples:

   ```sh
   npm run hello       # examples/hello: REPORT zhello. WRITE 'Hello, World!'.
   out/hello/zhello
   npm run classrun    # examples/classrun: ZCL_HELLO, out->write( ... )
   out/classrun/zcl_hello
   ```

4. Compile your own program, one root at a time:

   ```sh
   npm run build
   node build/src/cli.js --input <abapGit package> [--input ...] --root <program or class> --out <folder>
   ```

Output goes to stdout while the program runs: a list line as soon as it is finished, a console line at each
`out->write`. A compiled program runs with default user settings (decimal notation `1.234.567,89`, date format
`DD.MM.YYYY`), or as a user from a user setup file: `out/hello/zhello --user-setup users.json --user alice`. The file
format is in [docs/spec/write.md](docs/spec/write.md#the-user-setup-file).

`npm test` runs the end-to-end builds of small programs and the Go runtime's tests.

abap2go uses an abaplint release plus the fixes it needs that are not released yet: each fix is a PR to abaplint, and
until a release contains it, `patch-package` applies it from `patches/` on `npm install`
(`scripts/abaplint-patch.sh` regenerates the patch, `patches/abaplint-prs.txt` lists the PRs in it).

## License

abap2go is licensed under the [MIT License](LICENSE). It contains code ported or taken from open-abap-gui,
open-abap-core, abaplint/transpiler and open-steamgate, each under the MIT License; see [NOTICE](NOTICE) for what comes
from where and [LICENSES/](LICENSES/) for the license texts.

abap2go brings no SAP license. Make sure you have the right to compile the ABAP code you give it and to run it outside
an SAP system; check your SAP contract before relying on it.

SAP, ABAP and SAP NetWeaver are trademarks of SAP SE; Go is a trademark of Google LLC. abap2go is not affiliated with
or endorsed by either.
