# AOT for ABAP

Design notes for compiling ABAP ahead of time into a standalone native executable. Worked out in a discussion on
2026-11-24. Several points rest on measurements of open-steamgate's ABAP-to-Go backend (gogen), in
[open-steamgate-notes.md](open-steamgate-notes.md). The work items are in [roadmap.md](roadmap.md).
Decisions and the (now empty) open points are at the end.

## Guiding principle

**AOT compilation may not add a single bug to a program.** For every program, the compiler does exactly one of
two things:

1. **It refuses at build time**, naming the construct it cannot compile faithfully; or
2. **it produces an executable that behaves exactly as SAP would run the program.**

There is no third outcome. In particular, an executable never meets something it cannot do at run time: no
"not compiled" stub, no gap in a conversion rule that shows up as a dump, no silently different result. Every
decision below is judged against this rule.

The rule has to be read together with the closed world: **the build input is the system, expressed as an abapGit
package or a set of abapGit packages.** A class or table that is not in those packages does not exist, exactly as it does not exist on an SAP system where it was never
imported. A dynamic name that resolves to nothing then fails at run time with the exception SAP raises for an
unknown name, and that is behaving as SAP would.

**The environment is assumed correct.** The compiler is given a correct definition of the system, and the
underlying database is consistent with it. A wrong definition or an inconsistent database is an environment
problem, outside what the principle covers.

What the rule demands:
- **Every refusal moves to build time.** A construct the compiler does not support stops the build; it never
  becomes a run-time stub.
- **The generic run-time rules must be complete.** A move, comparison or calculation on generic operands is decided
  at run time, where a refusal is no longer possible. So the conversion, comparison and calculation-type rules must
  cover every pair of type kinds the language allows, or every generic operation whose operand kinds the compiler
  cannot bound is a build error.
- **The compiler's own type decisions must be exact.** A miscompilation such as two different structures merged
  into one type (a bug of this kind was found in gogen: [oisee/open-steamgate#1012](https://github.com/oisee/open-steamgate/issues/1012)) is exactly the kind of bug the rule forbids.
- **Optimisations must be invisible.** Trimming, specialisation and devirtualisation may not change what the
  program does.

## Goal and scope

- **Goal:** ABAP runs as a standalone executable at a speed comparable to Go. No ABAP application server and no
  Node/JS runtime. Connecting to an external database (PostgreSQL, HANA, ...) is allowed, and so is an embedded one.
- **Semantics:** classic modern ABAP is the reference: the current on-premise language with its modern syntax
  (7.40 and later). ABAP Cloud is not a reference, a model or a target.
- **What gets better is execution, not the language.** The gain comes from compiling less (only what can be
  reached) and from typed native code. No language improvements, and no checks, policies or security layers that
  classic ABAP does not have. Whatever classic ABAP does at run time, the executable does too.
- Open SQL translation to real SQL is out of scope. It is I/O-bound and existing shims can be ported.
- **Shared memory is out of scope for the compiler** (shared objects, `cl_shm_*`, anything shared in memory
  between sessions or roots). It is an environment problem: whatever a deployment needs there is provided by the
  environment, not by the compiler or its runtime.

## The kernel versus AOT

The SAP kernel is what this design deliberately does not rebuild:

- **The ABAP compiler is part of the kernel.** A program's load is generated on demand at run time, whenever it is
  missing or out of date. `GENERATE SUBROUTINE POOL` and `INSERT REPORT` call that compiler directly.
- **Every load carries a full symbol table.** That is why `ASSIGN ('(PROG)VAR')` can reach another program's
  global variable, and why any variable can be named at run time.
- **The dictionary is read from the database at run time** (the nametab), so `describe_by_name` and
  `CREATE DATA TYPE (name)` can name any type in the system.

The kernel is a VM with the compiler always present over an open world of names. AOT is the opposite: compiled once
and closed. The design question is what that costs in ABAP semantics, and the answer is "very little", as long as
the closed world is defined well.

## The closed world

1. **The world is the build input: an abapGit package or a set of abapGit packages**, in abapGit's serialized
   format. It is neither "what the source names" nor "everything in a system". Everything the program can know
   about its system comes from these packages: the source, the dictionary (TABL, VIEW, DTEL, DOMA, TTYP as XML),
   function groups with their remote-enabled flags, and configuration objects abapGit serializes, such as SICF
   nodes, which name their handler classes. Libraries the program depends on (open-abap-core's `CL_ABAP_*`, for
   instance) are packages of the set like any other.
2. **The compilation entry is one root** (see Decisions). A root is an entry point, and entry
   points are recognisable: the system calls only into classes that implement a known interface, even when the
   class name comes from configuration (SICF names the handler):

   | Entry kind | Marker |
   |---|---|
   | HTTP (ICF) | `if_http_extension` |
   | APC / WebSocket | `if_apc_wsp_extension` |
   | OData (SEGW) | the DPC's `/iwbep/` runtime interface |
   | BAdI implementation | the BAdI interface |
   | ABAP Unit | `FOR TESTING` |
   | Console class | `if_oo_adt_classrun` |
   | RFC function modules, reports, jobs | their own markers (remote-enabled flag, program type) |

   The marker says what can be a root; which root a binary is built for is chosen by naming it as the compilation
   entry.
3. **Reachability** runs from the root. An interface call is widened to all implementers in the world
   (class-hierarchy analysis).
4. *(Superseded for code names by the decision "Dynamic code names: only static names or a finite set". Kept for
   the reasoning, and because it still describes `CALL METHOD lo->(m)` and DDIC names.)*
   **A dynamic name bounded by a type pulls in the whole bounded set.** In `CREATE OBJECT lo TYPE (lv_name)` with
   `lo TYPE REF TO zif_x`, only implementers of `zif_x` can succeed, because anything else fails the fit check with
   `CX_SY_MOVE_CAST_ERROR`. The name may come from customizing or a BAdI table and the set is still known at build
   time:

   | Construct | Bounded set |
   |---|---|
   | `CREATE OBJECT … TYPE (n)` into `REF TO I` | implementers of `I`, their subclasses, and classes implementing an interface that includes `I` |
   | `CREATE OBJECT … TYPE (n)` into `REF TO` a class | subclasses of that class |
   | `GET BADI` | implementations of the BAdI interface |
   | `CALL METHOD lo->(m)` | methods of `lo`'s static type and its subtypes |
   | `CALL METHOD (c)=>(m)`, literal `m` | classes with a static method `m` |
   | `SELECT FROM (n)`, `CREATE DATA TYPE (n)` | dictionary objects of the world |

   Side benefits: the `EXPORTING` of a dynamic CREATE can be checked against each candidate's constructor, and a
   bounded set of one becomes a direct call.
5. **A name outside the world fails at run time**, exactly as an unknown name does on SAP
   (`CX_SY_CREATE_OBJECT_ERROR`, `CX_SY_DYN_CALL_ILLEGAL_CLASS`, ...). Nothing new is needed for this.

Where the bound breaks: a target of `REF TO object` (or a near-universal superclass such as `cx_root`) with the cast
to the interface happening later. The bound then exists only if the analysis follows the value to the cast. That is
data-flow tracking of type values, the hard part of this design.

## The dynamic features, sorted by cost

| Category | Examples | What it costs a compiled binary |
|---|---|---|
| Metadata only | `TYPE any`, `TYPE data`, field symbols, `REF TO data`, RTTI, RTTC, `CREATE DATA (name)`, dynamic calls, `ASSIGN COMPONENT`, `SORT BY (name)`, `READ … WITH KEY (name)` | Descriptors and signature tables, paid only where they are used. Compatible with Go speed. |
| Storage addressable by name | `ASSIGN (lv_name)`, `('(PROG)VAR')`, `('CLASS=>ATTR')` | A literal name is resolved by the compiler. A computed name needs a name-to-address table for that method or program. The compiler can see where such an ASSIGN exists, so only those methods and programs pay for it, and their variables cannot stay in registers. |
| Names arriving as data | class or table names from customizing, BAdIs, `SUBMIT (prog)` | Bounded by the type (above) or by the world. Outside the world: a run-time failure, as on SAP. |
| A small language at run time | dynamic `WHERE` in Open SQL or `LOOP AT … WHERE (cond)`, dynamic field lists and `ORDER BY` | Small interpreters over descriptors, not a compiler. |
| A full compiler at run time | `GENERATE SUBROUTINE POOL`, `INSERT REPORT` + `SUBMIT` | **Not supported.** This is what defines a kernel. |

## The runtime: metadata, not abaplint

No ABAP compiler is needed at run time for anything except the last row above. abaplint runs at build time and
exports what it knows as data:

- **Type descriptors.** A value of a generic type is a pointer plus a descriptor (in .NET terms a `TypedReference`).
- **Class and method signatures:** parameter names, kinds, types, optional/default, for dynamic calls and dynamic
  CREATE.
- **Dictionary metadata:** table → fields, kinds, lengths, key, client flag. It can live in the binary, or in the
  database as SAP's nametab does, loaded on first use.

**One descriptor builder, driven by metadata, serves three features:** RTTI (`describe_by_name`), RTTC
(`cl_abap_structdescr=>create`, `CREATE DATA … TYPE HANDLE`, `CREATE DATA … TYPE c LENGTH var`) and dynamic SQL
(a table no source references has no compiled struct). ABAP data types have no methods, so a type built at run time
is only a layout description and needs no code generation. This is where ABAP is easier than C#, whose `TypeBuilder`
needs Reflection.Emit.

**What the runtime does carry is ABAP's dynamic rules, as code:** the type-to-type conversion rules, comparison, the
calculation type of arithmetic on generic operands, and compatibility checks (dynamic call arguments, typed field
symbols on `ASSIGN (name)`, `CASTING`). Generic operations follow fixed rules over type kinds, with no overload
resolution, so this is a table and not a binder. C# `dynamic` needs part of the C# compiler at run time; ABAP does
not.

The compatibility rules then exist twice, statically in abaplint's check_syntax and dynamically in the runtime.
**Keep one shared set of test cases** (the same snippets checked by both) so the two cannot drift. The check_syntax
compatibility work in abaplint (abaplint#4689 functional results, abaplint#4642 fragment views) and transpiler#2249
(typed `ASSIGN (name)`)
doubles as the specification for the dynamic runtime.

**CASTING is the one real limit.** If values are stored as native values (a `c` as a native string, say), there is
no byte layout to reinterpret. CASTING between character-like or byte-like flat types can be emulated; general
CASTING cannot without changing how values are stored. Decided: native values, and every other CASTING is a
build error (see Decisions).

## Dynamic SQL

Supported fully, with SAP parity: `SELECT FROM (name)` reads any dictionary table of the world, and Open SQL does no
authorization check (an application that wants one calls `AUTHORITY-CHECK`, as SE16 does). It costs:

- the dictionary metadata above;
- the descriptor builder above, for the row and for the target (`CREATE DATA … TYPE STANDARD TABLE OF (name)`);
- the generic row path, slower per row than typed code but dominated by the database round trip;
- small parsers for dynamic `WHERE`, field lists and `ORDER BY`.

It removes one thing: knowing statically which tables a binary reads. That only matters if the schema is generated
from the program.

## Speed comes from typed code; generic code is the slow path

- Typed code compiles to plain native values (`int32` for `i`, `float64` for `f`, structs, slices), with the
  calculation type of every expression fixed at compile time, including the target. Measured: integer and float
  kernels run within 1.2–6× of hand-written Go.
- Everything generic goes through descriptors and is slower. That is acceptable where it is rare. It is not
  acceptable in hot generic code such as a JSON serializer over `TYPE any`.
- **Specialising at build time** is the way to recover speed there: when the actual type behind a `TYPE any`
  parameter is known at the call site, compile a typed copy of the method. That is what .NET's source generators do
  for serializers.
- Value representation decides speed more than the backend does (measured on gogen, see [open-steamgate-notes.md](open-steamgate-notes.md)): `p` must be fixed-point
  integers and not decimal text, HASHED and SORTED tables need a real hash map and binary search, a method call must
  not cost a closure plus a defer, and APPEND must not use reflection.

## Precedent: .NET Native AOT

| ABAP | .NET Native AOT |
|---|---|
| Closed world from the build input and its roots | Whole-program reachability (trimming) |
| `TYPE any` = pointer + descriptor | `TypedReference` |
| RTTI | `System.Type` over the reflection metadata the build keeps |
| RTTC: a data layout, no code | `TypeBuilder`: unsupported, needs Reflection.Emit |
| Dynamic CREATE / CALL METHOD | `Activator.CreateInstance`, `MethodInfo.Invoke` with pre-generated stubs |
| Generic operations: fixed rule table | C# `dynamic`: unsupported, its binder is part of the compiler |
| `ASSIGN (name)` of a local variable | no equivalent, reflection cannot see local variables |
| Dynamic `WHERE`: small interpreter | `Expression.Compile()` falls back to an interpreter |
| `GENERATE SUBROUTINE POOL`: unsupported | `Reflection.Emit`, `Assembly.Load(bytes)`: unsupported |
| Entry points are interface implementations | ASP.NET MVC controllers found by reflection: unsupported; ASP.NET wrote a code generator to make discovery a build step |
| Specialise hot generic code at build time | source generators (System.Text.Json, Regex) |

- **ABAP is easier:** no parametric generics, so none of NativeAOT's hardest problem (discovering every generic
  instantiation over a value type). Types built at run time are data only. Generic semantics are a fixed table.
  Entry points carry their marker in the language.
- **ABAP is harder:** local variables by name; names read from customizing are ordinary SAP style; the dictionary
  is an open world; dynamic SQL is everywhere.
- **History:** .NET Native for UWP failed at run time (`MissingMetadataException`); NativeAOT moved those failures
  to build-time analysis. This design goes the same way and further: a code name that is not static or a finite
  set is a build error (see Decisions), so nothing unresolved is left for run time.

## What abaplint has to provide

- **Correct types for valid code.** The compiler's types come from abaplint, so a mistyped expression becomes wrong
  native code. Fixing "valid ABAP that abaplint mistypes or fails to parse" (abaplint#4633, #4689, #4687, #1809,
  #4644/#4645) helps AOT directly. "Invalid ABAP that abaplint accepts" barely affects AOT output, because the
  input is code that already activates.
- **Metadata export:** descriptors, signatures and dictionary information, in a form the runtime can load.
- **A reverse index over the world:** interface → implementers, class → subclasses. abaplint's registry holds the
  data; the index does not exist yet.
- **Data flow of names, later:** following a class or table name, or a type value, to the point where it is bounded
  (the `REF TO object` case).

## Decisions (2026-11-24)

**In one line: a closed world for code, an open world for data types.**
- *Closed for code:* classes, methods, function modules, programs and forms are compiled only when the source
  names them statically (a literal, a constant, or a finite set in the method). Anything else is a build error.
  Class RTTI and the `TYPES` declared in classes belong to code and are closed too.
- *Open for DDIC data types:* a dictionary name requested at run time is looked up in the database dictionary and
  takes the RTTI path; RTTC builds types at run time. "Open" means open relative to what the program names; it is
  still bounded by the system definition (the packages), as on SAP.
- *Why the split:* a data type needs no code, so being open costs only metadata; a class needs compiled code, so
  it has to be closed.
- *Where they touch:* code that data triggers (conversion exits). Data types are open; the code a type can
  trigger is closed and bounded by what the root can reach (decision below).

- **Code triggered by data is bounded by what the root reaches.** A conversion exit is code named by a domain,
  and the kernel calls it implicitly (`WRITE`, `WRITE TO`).
  1. *Static operand:* the domain is known at build time, so exactly its exit is compiled.
  2. *Finite set:* the operand's type comes from a finite set of DDIC names (`CREATE DATA … TYPE (n)` with `n`
     assigned from literals), so exactly their exits are compiled.
  3. *Unbounded:* a statement that would implicitly call an exit on an operand whose type came from an unbounded
     DDIC name is a **build error** in that root.

  *Why:* "every exit referenced by a domain in the packages" would put the conversion logic of a whole ERP (20 GB
  of code) into a 1 MB service, each exit with its own closure. The service would no longer be small, and that is
  the case AOT exists for. A fast service serializes to JSON or XML, which call no exits; formatting dynamically
  typed data with `WRITE` is report territory. The OData gateway applies exits generically, but with the
  framework generated per service its entity types are static, so rule 1 applies.
  *Rejected:* all exits compiled once into a shared binary that services call. The exit would run in another
  session with its own database connection and would not see the caller's uncommitted LUW, which is a behaviour
  difference.
  *Later:* whether roots that really need dynamic exits on unbounded types must be supported is investigated
  when a real case hits rule 3.

- **Vehicle: an own project, a new compiler on abaplint, output in Go, the environment borrowed from
  open-steamgate.**
  - *Compiler:* written in TypeScript on `@abaplint/core`, **for now**. Node at build time is fine: "standalone"
    applies to the output, not to the compiler, and abaplint is where contributions already go. A hard
    decision, not an obvious one: Microsoft ported the TypeScript compiler itself from TypeScript to Go (2025,
    "Project Corsa"), and the reasons are weighed here.
    - *Why Microsoft moved, and what carries over:* interactive latency (`tsc` in editors on huge monorepos) does
      not apply, since builds happen on import, in batch. Parallelism (shared-memory threads; Node is effectively
      single-threaded) would help, but only matters if build cost does. Ownership points the other way: Microsoft
      ported its own compiler, while the frontend here is abaplint. Porting abaplint to Go would fork it for good,
      losing upstream fixes and cutting abaplint work off from the compiler that needs it. abaplint's
      parser and type checker are the most valuable part being reused.
    - *The real concern is scale:* a 20 GB ERP is far beyond what gogen measured (2,522 files: 190 s, about 10 GB
      heap in its frontend). The design compiles one root at a time and needs only its closure; abaplint's registry
      takes files incrementally, so the closure can grow in rounds. Parsing is fast (about 2,100 files, 207,000
      statements in about 11 s, measured 2026-11-24); the type check is slower and not measured at ERP scale.
    - *Safeguards that keep Go open:* the compiler's own parts (IR, lowering, emitter) are written to be portable,
      file by file, as Microsoft did: a plain-data IR, no JS-specific tricks, simple structure.
    - *Revisit trigger:* build one root's closure out of a large package set, type check included, and measure
      time and memory. If that is unacceptable, look at the closure strategy first; a port to Go is decided on that
      number, not before.
  - *Output:* Go. Borrowing open-steamgate's Go host as the environment settles it; Go also fits on its own
    (garbage collection, a goroutine per session) and gogen's measurements show its speed is right once the value
    model is.
  - *Environment, borrowed:* from open-steamgate's Go host (MIT, © 2026 Alice Vinogradova and contributors), as an
    attributed snapshot, owned from then on, not tracked upstream (109 commits a month to `tools/gogen`): the
    database connection, LUW and per-step connection (`abap/db.go`, `luw.go`, `stepconn.go`), Open SQL to real
    SQL including the dynamic WHERE parser (`irsql.go`, `osqlwhere.go`, `selectdyn.go`, `dbwrite.go`,
    `tables.go`), the lock server (`enq`, `enqnet`, `enqseam`), work processes and sessions (`workpool`,
    `session`, `instance`, `serving`), the HTTP host for `if_http_extension` roots (`abap/icf.go`, `osgw`,
    `cmd/osgo`), and the build-time Node tools (abapGit import, DDIC to schema, seed data). The JS host side
    (Express, the service-worker preview) is not needed.
  - *A seam first:* in gogen the database, LUW and ICF code share a Go package and types with the value model this
    design replaces (`p` as text, `Data{P, T}`). The interface between compiled code and environment (database, LUW,
    locks, jobs, HTTP) is defined first, then each piece is ported behind it, as a module separate from the
    compiler's own runtime (value model and rule tables).
  - *Its gaps become build errors:* Open SQL forms the borrowed lowering does not cover (`FOR ALL ENTRIES`, `JOIN`,
    `GROUP BY`, dynamic clauses, `IS NULL`, run-time `NotCompiled` stubs in gogen) are refused at build time under
    the guiding principle, so the environment's coverage decides which programs compile.
  - *Borrowed knowledge too:* open-steamgate's `ANORMALIES.md` (SAP-vs-open-abap differences, mostly measured on a
    real system) and the 304 test classes in `tools/gogen/testdata*` with answers measured on A4H seed the
    rule-table specification. The compiler itself (frontend, IR, emitter, value model) is not taken over: this design changes its
    value model, its refusal model (build time instead of run time) and its closure model (one root).
- **Storage: native values, partial CASTING.** Values are native types (`int32`, strings, fixed-point integers for
  `p`) for the fastest typed code. `ASSIGN … CASTING` works only between character-like or byte-like flat types;
  every other CASTING is a **build error**. This is a known gap against SAP, accepted for speed; under the guiding
  principle it is a refusal, never a different result.
- **One root per compilation.** The compiler is invoked for one root (an entry point: an ICF handler, an RFC
  module, a report, …), not for a whole package set, and compiles what that root reaches: one binary per root.
  There is no manifest: with only static names and finite sets for code (decision below), nothing unbounded is
  left for a manifest to supply, so everything a root needs follows from its source.
  - *Why the costs do not matter:* builds happen on import, automated from the SAP system, so compiling shared code
    once per root is invisible. Disk space is no concern. Memory is not either: SAP also generates a load per
    program and keeps it in memory, and an optimised native binary is a better form of it than unoptimised
    bytecode.
  - *Services shared across roots are environment, as on SAP:* the database, the enqueue lock server, background
    job scheduling (`JOB_SUBMIT` starts another root), the update task, shared memory. No binary carries them.
  - Code a root reaches directly (a local `CALL FUNCTION`, `SUBMIT … AND RETURN` with a literal name) is ordinary
    reachable code and is compiled into that root's binary.
- **Dynamic code names: only static names or a finite set.** For every statement that names code at run time
  (`CREATE OBJECT … TYPE (n)`, `CALL METHOD (c)=>(m)`, `CALL METHOD lo->(m)`, `CALL FUNCTION f` with a variable,
  `SUBMIT (p)`, `PERFORM (f) IN PROGRAM (p)`, `CALL TRANSACTION (t)`), the name must be
  1. a literal or a constant, resolved at build time; or
  2. a finite set the compiler sees inside the method: the name variable is assigned only literals or constants
     (in `IF` / `CASE` branches, say).

  Anything else is a build error. This replaces the type-bound sets, the pragma and the global interface list that
  were discussed before: a compiled program reaches only statically known classes, function modules and programs.
  - `CALL METHOD lo->(m)`: the method name is a code name like any other and follows the same rule. The object
    behind `lo` was created by one of the program's statically known CREATEs, so with a literal `m` the call
    dispatches among the compiled classes that have a method `m`, even when `lo` is `TYPE REF TO object`. If the
    object at run time lacks the method, SAP's `CX_SY_DYN_CALL_ILLEGAL_METHOD` is raised, as on SAP; if no
    compiled class has a method `m` at all, the literal names nothing and the build fails. Measured: 343 of 345
    such calls in the scanned code bases already use a literal or constant; the two computed ones are a unit-test
    runner and a benchmark runner, which call test methods by name (see Open points).
  - A literal or constant naming a class, function module or program that is not in the packages is a **build
    error**. Code written to tolerate a missing class (abapGit's `CALL METHOD ('CL_…')=>…` inside a TRY, so one
    source runs on several releases) is not supported: an AOT build targets one system, so whether the class exists
    is a fixed fact, and such code is hard to maintain and does not need speed. Supporting it would trade the loud
    detection of an incomplete package set for a silent `CATCH` fallback.
  - With one root per compilation, `sy-repid` and `sy-cprog` are constants of the root, so names built from them
    (`|\PROGRAM={ sy-repid }\CLASS=lcl|`, `SUBMIT (sy-cprog)`) count as rule 1.
  - *What it costs* is measured under "What the static-name rule costs" below.
- **DDIC: a static name is compiled, a dynamic name is looked up and takes the RTTI path.** The same rule for
  every dictionary object: tables, views, structures, data elements, domains, table types.
  - *Static:* a DDIC name the source states is compiled from the packages' DDIC XML at build time into typed code
    and descriptors. Nothing is looked up at run time.
  - *Dynamic:* a DDIC name requested at run time (`describe_by_name`, `CREATE DATA … TYPE (n)`,
    `SELECT FROM (n)`, `cl_abap_typedescr` lookups and the like) is looked up in the dictionary held in the
    database, as SAP reads its nametab. A descriptor is built from that metadata, and everything from then on goes
    through the generic RTTI path. The database holds the metadata of every dictionary object of the packages, so
    a dynamic name finds whatever SAP would find in that system.
  - Classes are not covered by this rule; their dynamic names follow the closed-world rules above.
  - *Assumption:* the compiler is given a correct definition of the system, and the database is consistent with
    it. Keeping the database's tables and metadata in step with the packages the binary was compiled from is the
    environment's job, not the compiler's or the runtime's, and an inconsistency there is not a bug AOT added.

- **Generic run-time rules: complete from the start, one implementation per cell.**
  - *Why complete is forced:* a `TYPE any` operand can hold a value whose type came through the open DDIC path at
    run time (`CREATE DATA … TYPE (n)`, `SELECT FROM (n)`), so the compiler cannot bound the operand kinds of a
    generic operation. Refusing unbounded generic operations would make the open world for data exist on paper
    only. And a missing rule cannot be refused at run time, so any gap would be an incorrect dynamic assignment,
    which the guiding principle forbids.
  - *Why it is finite:* the dictionary adds no new kinds. Every DDIC type reduces to one of ABAP's built-in kinds
    (`c n d t x string xstring i int8 b s p f decfloat16 decfloat34 utclong`) plus length and decimals; structures
    and tables follow component rules (fragment views for flat structures). "Complete" means three finite tables:
    conversion (about 16 × 16 cells: `=`, `MOVE`, parameter passing, `MOVE-CORRESPONDING`, table keys),
    comparison (`=`, `<`, `IS INITIAL`, generic `READ … WITH KEY (name)`, `SORT`) and calculation type
    (arithmetic, `COLLECT`, `DIV` / `MOD` / `**`), plus a smaller output-formatting table per kind (`WRITE`,
    string templates). Every cell includes its exception (`CX_SY_CONVERSION_NO_NUMBER`, `…_OVERFLOW`, …), and
    pairs that are a syntax error with static types are a run-time error with generic ones, as on SAP.
  - *No staging:* the tables are complete before the generic path ships. Growing them kind by kind is not an
    option: dynamic SQL can bring any table's types into any root with a generic operation, and a large system
    uses every kind anyway.
  - *One implementation per cell, used twice:* static operands call the cell directly (typed, fast); generic
    operands look the cell up from the two actual kinds (one lookup per operation). Writing the rules twice would
    let the two drift, and that drift would be exactly a bug AOT added.
  - *Specification:* the keyword documentation's conversion tables give the structure; the abaplint/transpiler
    issues raised while checking it against ABAP are cells worked out one by one (int8 → d/t transpiler#2243,
    p → c #2174, p → n #2175, x → n #2204, decfloat → c #2179, f → p #2209, …), and their snippets become test cases run against the static and the
    generic path.

- **`ASSIGN` by name: member access supported, variable names static.** `ASSIGN` with a dynamic name is two
  features: looking up a member of a structure or object, and looking up a variable of the program.
  1. *Member access by name is supported:* `ASSIGN COMPONENT`, `struc-(comp)` through the descriptor (open data
     path); `ref->(attr)` through attribute tables generated only for the compiled classes that are targets of such
     access; `(c)=>(attr)` with `c` under the static-name rule. Failure behaves as on SAP (`sy-subrc = 4`, visibility
     checked from the calling context).
  2. *Variable names follow the code-name rule:* a literal or a finite set, resolved at build time like an ordinary
     variable reference (the name syntax `a-b`, `a->*`, `C=>attr` is parsed at build time, so the runtime needs no
     name parser). A computed name is a build error. Supporting it would need a per-statement name table over the
     symbols in scope and would keep those variables out of registers; it occurs zero times in the scanned code
     bases. If a real case hits it, the scope-bounded table is the known way to add it.
  3. *`'(PROG)VAR'`:* `PROG` is a code name: static, and in the packages, else a build error. That refuses the
     classic user-exit reach into SAP standard programs (`'(SAPMV45A)XVBAP[]'`), which only makes sense inside
     SAP's own transactions, not in an AOT root. If `PROG` is in the packages but not reachable from the root, it can
     never be loaded in the session, and the assign compiles to `sy-subrc = 4`, as SAP answers for an unloaded
     program. If it is reachable, the runtime checks whether it has been loaded in this session (state it keeps
     anyway for `LOAD-OF-PROGRAM` and class constructors).
  4. *A literal naming something not in the packages is a build error,* as for code (abapGit's
     `ASSIGN ('IF_…=>…')` dependency-avoiding style).

  Measured in the six code bases: 698 `ASSIGN COMPONENT`, 22 member accesses by name, 19 literal variable names,
  4 literal `'(PROG)VAR'` (all into SAP standard programs), 0 computed variable names.

- **Test runners are generated.** ABAP Unit calls test methods by name (`lo_obj->(ls_input-method_name)` in
  open-abap-core's runner), which the static-name rule refuses. For a test root the compiler generates the runner
  itself, with one literal call per `FOR TESTING` method (rule 2): it knows every test class and method anyway.

- **Specialising generic methods: deferred.** A method with a generic parameter (`TYPE any`, `data`, `simple`,
  `clike`, `numeric`, generic-length `c` / `p`, `ANY TABLE`, …) runs on the generic path; when a call site passes a
  statically typed actual, the compiler could emit a typed copy for that type.
  - *Correctness never depends on it.* The complete rule tables and the generic path come first and define the
    semantics.
  - *Safe by construction:* a specialised copy calls the same cells the generic path looks up (one implementation
    per cell), so it cannot behave differently. One trap: an operation invalid for a particular actual type fails at
    run time on SAP, and only when that path runs; the specialised copy must emit the same run-time error, never a
    build error.
  - *Two levels:* (1) type substitution, which makes moves, comparisons and arithmetic typed; mechanical, and it helps
    utility methods and `cl_abap_unit_assert=>assert_equals`. (2) Folding RTTI (`describe_by_data( param )` as a
    constant, loops over components unrolled), which helps serializers and mappers, but is partial evaluation, a
    project of its own.
  - *Risk:* code growth, since a copy per actual type cascades through the generic methods it calls; it needs a
    limit (N types per method, or small methods only). Go's own generics do not help: they instantiate per memory
    shape with a run-time dictionary.
  - *When:* level 1 once the generic path is measured as a bottleneck; level 2 when a real hot path needs it.
    Measure first what a generic operation costs against typed code.

- **Hosting follows open-steamgate; its AOT compiler does not.** Whatever open-steamgate provides as host
  (list processing, the console, the build layout, later the database, LUW, locks and HTTP) is reused; its
  compiler (frontend, IR, emitter, value model) is not. Decided 2026-11-24 with the first hello world:
  - *Reports* run their basic list through open-abap-gui's classic list processor (`ZCL_GG_HOST_LIST`, MIT),
    ported to the Go runtime: one blank between outputs, `WRITE /` starts a line, no wrap at the list width
    (default 132), lengths count characters, trailing blanks removed per line, the standard page header not
    written. Only `START-OF-SELECTION` (explicit or implicit) is supported; every other event is a build error.
  - *Output streams.* Where open-steamgate hands the list over when the program ends, abap2go writes each list
    line to stdout as soon as it is finished: layout only looks at the current line, so a finished line never
    changes. Statements that read or change earlier lines (`READ LINE`, `MODIFY LINE`) are build errors for now.
  - *`if_oo_adt_classrun` is a root kind*, for console programs: an instance is created and `main` runs with
    the console as `out`. `out->write` writes one line at once, unbuffered, formatted as open-steamgate's
    `ZCL_OSD_CLASSRUN_OUT` does (a value converted to string, `name = value` with a name). The interfaces come
    from open-abap-core, in the built-in library package `lib/`.
  - *Build layout* as open-steamgate's osabap: the generated root is `package main` in `cmd/<root>` inside a copy
    of the runtime module, built with `-trimpath` and a stripped binary. No layered packages until build time
    matters.
  - *Release:* the input is checked as ABAP 7.58.

## What the static-name rule costs (measured 2026-11-24)

Every statement naming code dynamically, found with abaplint's parser (unit tests excluded) in six code bases:
abapGit, open-abap-core, ajson, open-abap-gui, open-abap-odata and open-steamgate's own `src/`. Together about 2,100
files and 207,000 statements.

| Code base | Literal / constant names | Computed names | `obj->(m)` (unaffected) |
|---|---:|---:|---:|
| abapGit (619 files) | 220 | 39 | 333 |
| open-abap-core (404) | 0 | 3 | 5 |
| ajson (17) | 2 | 2 | 5 |
| open-abap-gui (549) | 1 | 10 | 2 |
| open-abap-odata (89) | 0 | 3 | 0 |
| open-steamgate `src/` (415) | 0 | 28 | 0 |

The literal sites compile under rule 1. The 85 computed sites fall into patterns (classified by reading them; a
rough split, not an exact count):

- **A literal hidden in a variable (about a third, rule 2 compiles them):** `lv_class = 'CL_ABAP_CONV_IN_CE'.`
  then `CALL METHOD (lv_class)=>create` (abapGit and ajson do this to avoid a hard dependency), the RAP registry
  named once in a variable, class-level constants, the user exit as a literal or a local class of `sy-repid`.
- **Dispatch by naming convention (prefix + data):** abapGit finds the serializer of each object type as
  `ZCL_ABAPGIT_OBJECT_` plus the type; open-steamgate builds `ZCL_STG_TAB_<table>`. Refused.
- **Dispatch through a registry or configuration row:** the OData service registry creating MPC and DPC from the
  registration, ICF and ADT route tables, RAP entity sources and handlers, APACK manifest providers, background
  job classes, open-abap-gui's transaction registry. Refused.
- **Function modules by name:** abapGit's generic object handling, conversion exits (`CONVERSION_EXIT_<x>_INPUT`
  from the domain), an existence check, a dummy update module. Mostly refused.

**What is sacrificed:** few statements (85 in 207,000), but they sit at the core of frameworks. Application code
rarely computes a class name; frameworks always do. abapGit does not compile (its object serializers are found by
convention, and it tolerates missing classes on purpose), and neither do the OData gateway's service registry, the
route tables or the job framework as written today. **That is an acceptable loss:** code built on dynamic dispatch
is hard to maintain and is not where speed is needed. AOT is for the code that needs speed; supporting this style
would be a large trade-off for code that gains nothing from it.

**The way back within the rule:** generate the dispatch from the configuration objects in the packages, as a
class with one literal per entry (`CASE name. WHEN 'X'. CREATE OBJECT r TYPE zcl_x. …`). That is rule 2, and
open-steamgate already does it for its SEGW and search-help registries. Frameworks then must be generated rather
than configured at run time. Applications are unaffected.

## Open points

None as of 2026-11-24: the scope is considered complete. Deferred items (dynamic exits on unbounded types,
computed variable names in `ASSIGN`, specialisation) are reopened only when a real case needs them.
