# abap2go

An ahead-of-time (AOT) compiler for ABAP: ABAP compiled into standalone native executables that run at a speed
comparable to Go, with no ABAP application server and no JavaScript runtime. A database, embedded or external, is
allowed.

**Status: first steps.** Hello world compiles, as a report and as an `if_oo_adt_classrun` console class; every
other construct is refused at build time. The design and the plan are in `docs/`.

## Try it

Needs Node and Go.

```sh
npm install
npm run hello       # examples/hello: REPORT zhello. WRITE 'Hello, World!'.
out/hello/zhello
npm run classrun    # examples/classrun: ZCL_HELLO, out->write( ... )
out/classrun/zcl_hello
npm test            # end-to-end builds of small programs, and the Go runtime's tests
```

`node build/src/cli.js --input <abapGit package> [--input ...] --root <program or class> --out <folder>` compiles
one root. Output goes to stdout while the program runs: a list line as soon as it is finished, a console line at
each `out->write`.

## The idea in brief

- **AOT adds no bugs.** For every program, the compiler either refuses at build time, naming what it cannot
  compile faithfully, or produces an executable that behaves exactly as SAP would run the program.
- **Classic modern ABAP is the reference:** the current on-premise language, 7.40 and later. ABAP Cloud is not a
  target.
- **A closed world for code, an open world for data types.** Classes, function modules and programs are compiled
  only when the source names them statically. Dictionary types requested at run time are looked up and handled
  through RTTI, as on SAP.
- **One root per compilation.** An entry point (an HTTP handler, an RFC module, a report) and only what it reaches
  becomes one binary.
- **Built on [abaplint](https://github.com/abaplint/abaplint)**, in TypeScript, emitting Go. The runtime
  environment (database, LUW, Open SQL lowering, locks, HTTP host) is borrowed from
  [open-steamgate](https://github.com/oisee/open-steamgate) (MIT).

## Documents

- [docs/aot_for_abap.md](docs/aot_for_abap.md): the design, its guiding principle and its decisions
- [docs/roadmap.md](docs/roadmap.md): the critical path (the specification of ABAP's conversion, comparison and
  calculation rules) and the work items in abaplint, open-abap-core and the transpiler
- [docs/open-steamgate-notes.md](docs/open-steamgate-notes.md): measurements of open-steamgate's Go backend, the
  closest prior art

## License

[MIT](LICENSE). Code borrowed from other MIT-licensed projects keeps its copyright notice and license text.
