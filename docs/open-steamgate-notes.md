# Notes on open-steamgate's Go backend

Measurements of gogen, the ABAP → Go backend of [open-steamgate](https://github.com/oisee/open-steamgate)
(`tools/gogen/`, MIT), taken from its source and by running it, at `main` `9d2f0529`, 2026-11-24. gogen is an
impressive body of work and the closest prior art to abap2go; these notes record what was measured, as input to
[aot_for_abap.md](aot_for_abap.md), and are not a review of the project. Numbers are from one machine and one
set of probe programs, so they are indications, not benchmarks.

Machine: AMD Ryzen 7 7735HS, Windows 11, Go 1.27.2, Node 26.13.1. The probe programs lived in a session scratch
folder and are not kept; everything needed to redo them is described here.

## Pipeline

ABAP → `@abaplint/core` (parse, scopes, types) → the transpiler's `Rearranger` (operator precedence) → gogen's own
typed IR (`frontend.mjs`) → Go (`emit-go.mjs`) → Go runtime `go/abap`. The transpiler's JS runtime
(`@abaplint/runtime`) is **not** used: transpiler runtime fixes reach Go only as reference behaviour.
open-abap-core classes are compiled from their ABAP source; their `@KERNEL` / JS parts are replaced by native Go.

## Static code: typed design, fastest on i and f

The typed design described in its documentation is what the code does. Locals are typed Go variables, methods are plain functions, interfaces
are Go interfaces, and there are no type tests at run time.

**The repo's own benchmark** (`tools/gogen/run.mjs`, one sample class, four cases, all `i`/`f`), generated Go
against the same kernels written by hand in Go:

| Kernel | Generated Go | Hand-written Go | Generated slower by |
|---|---:|---:|---:|
| primes to 50 000 | 2.2 ms | 1.9 ms | 1.2× |
| plasma frame (sin/cos) | 4.3 ms | 3.0 ms | 1.45× |
| 1M-row standard table | 21 ms | 8.3 ms | 2.5× |
| fib(25), recursive calls | 2.1 ms | 0.38 ms | 5.7× |

Causes, each confirmed by removing it from a copy of the generated code:
- every method call is wrapped in a closure with `defer abap.MessageCallScope(...).Restore(s)`
  (`go/abap/registry.go:155`): removing it takes fib from 2.1 ms to 0.45 ms;
- every APPEND calls `abap.BumpTable` (`go/abap/row_binding.go:117`, reflection + a version lookup): removing it
  halves the table case;
- ABAP's overflow checks (`AddI` etc.) cost almost nothing.

`run.mjs` does not run on Windows as it is: it spawns `.out/bench` without `.exe`.

**A business-shaped class** written for this analysis: a structure (`i`, `c(20)`, `string`, `p(10,2)`), a
standard table with `LOOP … WHERE`, a HASHED and a SORTED table read by key, string building, calls through an
interface. gogen compiled all of it with no refusals, and gogen Go, hand-written Go and the transpiler's JS returned
the same values.

| Workload | gogen Go | Hand-written Go | Transpiler JS | gogen vs Go | gogen vs JS |
|---|---:|---:|---:|---:|---:|
| table of structures, `p` sum, 200k rows | 920 ms | 49 ms | 356 ms | 19× slower | 2.6× slower |
| string building, 200k | 710 ms | 15 ms | 165 ms | 47× slower | 4.3× slower |
| HASHED insert + read by key, 20k | 905 ms | 5.3 ms | 55 ms | 170× slower | 16× slower |
| SORTED insert + read by key, 20k | 4.7 s | 0.15 s | 0.41 s | 32× slower | 12× slower |
| interface calls, 200k | 5.1 ms | 0.7 ms | 52 ms | 7× slower | 10× faster |

On these workloads, except calls, the generated Go was slower than the transpiler's JS. The causes are in the
runtime's value representation, not in the approach:
- **`p` is a decimal string.** Each operation parses it into a `big.Int`, computes and formats it back
  (`go/abap/packed.go:161`, `PFit` at `:259`). Even `lv_c = sy-index` into a `c` goes through
  `PToC(PFit(IToP(...)))`.
- **HASHED tables are slices.** INSERT scans the whole table for a duplicate and READ by key scans linearly:
  O(n²) to fill. The 170× grows with n.
- **SORTED tables** are read by a linear scan, not a binary search, and each insert scans for its position.
- `sy` fields are written through the session pointer in every loop iteration (minor).

**Takeaway:** the typed frontend and IR carry the speed; the value representation decides whether it shows. For
abap2go this means fixed-point integers for `p`, a hash map and binary search for keyed tables, no defer per
call and no reflection per APPEND.

## Dynamic code: a closed world

- **Generic data** is `abap.Data{P any, T *Type}` (`go/abap/data.go:70`): a pointer to the real storage plus a
  generated descriptor. `MoveData` switches on a one-byte type kind, with little reflection. Sound and cheap, but
  combinations it lacks raise NOT_COMPILED, and a whole-structure move needs the identical descriptor on both sides.
- **The class world** is built by `frontend-closure.mjs` (52 lines) from statically named classes plus
  superclasses. `CREATE OBJECT … TYPE (name)` looks the name up at run time among whatever happens to be compiled;
  there is no implementer-based closure. Constructor arguments on a dynamic CREATE are refused.
- **Dynamic calls:** only `(class)=>(method)` with EXPORTING/RECEIVING, arguments passed in a `map[string]Data`.
  IMPORTING, CHANGING, EXCEPTIONS, `PARAMETER-TABLE`, dynamic `SET HANDLER` and dynamic `CALL FUNCTION` forms are
  refused. I found no instance form `obj->(name)`.
- **The type world is closed too.** Every descriptor (`abap.Type`, `go/abap/data.go:20`) is generated with a Go
  struct; its `Get` / `Copy` / `Zero` / `New` work on that struct's fields. Nothing builds a `Type` at run time.
- **Dynamic SQL:** `SELECT … FROM (name) … WHERE (cond)` works through a WHERE parser ported to Go
  (`go/abap/osqlwhere.go`) and a table registry generated at build time ("every TABL and DDIC view the program
  knows"). A table with a column type outside the subset gets no descriptor.
- `GENERATE SUBROUTINE POOL` is refused ("there is no compiler at run time").

**RTTI / RTTC probe**, compiled together with open-abap-core's RTTI classes and run in Go:

| What | Result |
|---|---|
| `describe_by_data( ls )->components` | works |
| `describe_by_data( ls )->get_components( )` | works |
| `cl_abap_structdescr=>create( comps )` | fails: `cl_abap_elemdescr=>get_c` uses `CREATE DATA … TYPE c LENGTH p_length`, refused |
| `get_p( 8, 2 )`, `get_x( 4 )` | fail the same way |
| `CREATE DATA … TYPE HANDLE` | no IR form (`frontend.mjs` ~5160: "HANDLE … not taken here") |
| `ASSIGN … CASTING TYPE HANDLE` | refused |
| `describe_by_name` | dictionary structures and class `TYPES` only (`emit-go.mjs` ~605) |

RTTI reading works for typed data; no type can be built, not even an elementary one with a run-time length. The
blockers are in gogen's frontend and runtime, not in open-abap-core.

## Observation: structures with equal field names share a Go type

Three methods of one class declared local structures with the same component names and different types
(`a i, b c(5)` / `a i, b i` / `a i, b string`). All three compiled to one Go type, `ZCL_…__S_A_B`, whose `b` is a
string carrying the `c(5)` descriptor. `ls-b = 7` in the `i` variant silently stored the text `"7"`.

Cause: `tools/gogen/frontend-types-signatures.mjs:137` builds the "shape" that decides whether two structures are
the same from component **names** only, never from their types. Any two structures in one class with equal field
names and different field types are affected, not only RTTI code. Fix: put each component's type into the shape. Reported as
[oisee/open-steamgate#1012](https://github.com/oisee/open-steamgate/issues/1012) (2026-11-24), with a minimal
reproducer: two methods whose `b` is `c LENGTH 5` and `string`; the second returns 5 instead of 11.

## What this means for abap2go

- abaplint is the shared frontend: its types become native code, so fixes to how abaplint types valid ABAP reach
  the compiler directly.
- open-abap-core's pure ABAP classes compile as they are; its kernel and JS parts are replaced natively.
- The transpiler's JS runtime does not carry over. Its issues still matter as specification cells: each one is a
  snippet with ABAP's expected behaviour.
