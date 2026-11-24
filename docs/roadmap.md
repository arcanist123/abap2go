# abap2go roadmap

Issue numbers: `abaplint#` = abaplint/abaplint, `open-abap-core#` = open-abap/open-abap-core,
`transpiler#` = abaplint/transpiler; a bare number belongs to the repository of its section.

## Purpose

**The goal is an AOT compiler for ABAP:** ABAP compiled ahead of time into standalone executables that run at a
speed comparable to Go, with no ABAP application server and no JS runtime (a database, embedded or external, is
allowed). The design is [aot_for_abap.md](aot_for_abap.md). Work on abaplint, open-abap-core and the transpiler
is listed here to the extent that it moves the AOT compiler forward.

Priority, when choosing what to pick up next:
1. **the specification of ABAP's rule tables** (the critical path, below): runtime-neutral, SAP is the reference
2. **abaplint** (parser, check_syntax): the compiler's types come from abaplint, so a mistyped expression becomes
   wrong native code. Within it, valid ABAP that abaplint mistypes or fails to parse comes before invalid ABAP that
   abaplint accepts, because the compiler's input is code that already activates
3. **open-abap-core**: its pure-ABAP classes (RTTI, XML, JSON, HTTP, conversions, ...) are compiled into AOT
   binaries as they are; its kernel and JS parts do not carry over
4. **transpiler**: only where it serves the AOT compiler. Fixing the JS runtime does not carry over; what does is
   each issue's snippet and expected behaviour, which goes into the specification

- ABAP behaviour is the reference, not abaplint's rules. **Classic modern ABAP is the reference**: the current
  on-premise language with its modern syntax (7.40 and later), not ABAP Cloud
- the expected behaviour is worked out (keyword documentation, the snippets in the issues) before it goes into a
  test or a PR
- nothing that would stop ABAP from compiling ahead of time: nothing that needs a JS host or a compiler at run time
- lint rules are out of scope: only the parser, check_syntax and the transpiler count

This file is the source of status for abap2go and the work it needs in other repositories.

## The compiler (status 2026-11-24)

TypeScript on `@abaplint/core`, emitting Go (`src/`, runtime in `runtime/go`); `npm test` builds and runs small
programs end to end and runs the Go runtime's tests. No CI yet.

Done:
- hello world, PR #1 (`a6f3f83`): an abapGit package is syntax-checked as v758, one root is lowered to a
  plain-data IR and built into one native executable; anything else is refused at build time
  - roots: a report (`WRITE [/] '<literal>'`, `START-OF-SELECTION` only) or a class implementing
    `if_oo_adt_classrun` (`out->write( )` of literals)
  - hosting follows open-steamgate (see the decision in [aot_for_abap.md](aot_for_abap.md)): open-abap-gui's
    list layout (`ZCL_GG_HOST_LIST`, ported from the MIT upstream open-abap/open-abap-gui; the oisee fork's LICENSE
    only says "todo"), the console as open-steamgate's `ZCL_OSD_CLASSRUN_OUT`, the build layout of osabap
  - output streams: a list line goes to stdout as soon as it is finished, a console write at once

Next:
- [ ] to agree first: `DATA x TYPE i`, arithmetic, `WRITE x`. Starts the value model (native `int32`) and the
  first formatting cells: integer output length 11, right-aligned, sign at the end (open-steamgate's
  ANOMALY-2026-10-17-list-integer-width: it prints `6` where SAP is expected to print it in 11 columns)
- [ ] `WRITE` of a `c` literal ending in blanks and `WRITE ''`: refused, because open-steamgate's converter drops
  the blanks and SAP's result is not measured. Work out the expected output (keyword documentation)
- [ ] port the rest of the list processor as the compiler needs it: positions and lengths, `NO-GAP`,
  justification, `ULINE`, `SKIP`, `NEW-LINE`, then `TOP-OF-PAGE`; open-steamgate's `tools/gogen/testdata-list`
  and its ANORMALIES list entries are the test cases
- [ ] `out->write( )` of structures and tables (open-steamgate's format: a structure as one
  `field: value, field: value` line, a table as a header row and tab-separated rows)
- [ ] CI (Node and Go, `npm test`)

## Critical path: the specification of ABAP's rule tables

[aot_for_abap.md](aot_for_abap.md) decided that the generic run-time rules must be **complete from the start**:
an operand of `TYPE any` can hold any DDIC type at run time (dynamic SQL, `CREATE DATA … TYPE (n)`), and a missing
rule cannot be refused at run time, so any gap is a wrong assignment. The generic path, and with it dynamic SQL and
RTTI, cannot ship before the rules are complete.

**What is on the critical path is the specification, not any implementation.** For every cell: the expected
behaviour (including the exception SAP raises), its source in the keyword documentation, and a test snippet. It is
runtime-neutral: an AOT runtime implements it once in its own code, and the JS transpiler's runtime does not carry
over. Expected behaviour is worked out as for everything in this file (keyword documentation, snippets); SAP is
the reference, no runtime is.

The tables, over the elementary kinds `c n d t x string xstring i int8 b s p f decfloat16 decfloat34 utclong`
(structures and tables follow component rules and fragment views):

| Table | Covers |
|---|---|
| conversion (about 16 × 16) | `=`, `MOVE`, parameter passing, `MOVE-CORRESPONDING`, table keys |
| comparison | `=`, `<`, `IS INITIAL`, `READ … WITH KEY`, `SORT` |
| calculation type | arithmetic, `COLLECT`, `DIV` / `MOD` / `**`, overflow classes |
| output formatting | `WRITE`, string templates, `DESCRIBE … OUTPUT-LENGTH` |

**Cells already worked out.** The transpiler issues below were found by checking the transpiler against ABAP's
rules, so each one carries a snippet and its expected behaviour: they go into the specification as cells. Whether
to also fix the JS runtime is a separate decision per issue and is not on the critical path.
- conversion: #2243 int8 → d/t, #2196 c → int8, #2174 p → c, #2175 p → n, #2204 x ↔ n, #2179 decfloat34 →
  c/string, #2213 decfloat34 → n, #2180 f → decfloat34, #2209 f → p, #2245 decfloat34 range, #2229 flat structures
  with non-matching fragment views, #2222–#2227 CORRESPONDING
- comparison: #2166 p with int8, #2139 AS TEXT
- calculation type: #2259 text in scientific notation, #2253 int8 `/` with a p or f target, #2237 int8 with f,
  #2165 `**` with int8, #2195 `ipow( )` with int8, #2167 p above 2^53, #2171 MOD with p, #2172 / #2218 / #2189 /
  #2192 / #2188 overflow classes, #2177 / #2178 / #2181 / #2183 decfloat34
- formatting: #2182 template styles for decfloat, #2197 DECIMALS for int8, #2248 OUTPUT-LENGTH

Next:
- [ ] write the specification as a file in this repo: one row per cell of each table, with its expected
  behaviour, its source (keyword documentation section), its snippet, and where it came from (worked out / issue #),
  so the gaps are visible instead of implied
- [ ] carry the cells above into it
- [ ] work out the kinds not covered yet: c, string, x, xstring, d, t, utclong
- [ ] work out the comparison and formatting tables as tables, not only as single cells


## Work items

Reranked 2026-11-24 under the Purpose: the AOT compiler first. The critical path (the rule-table specification)
is above. Below it, in order:
1. abaplint: valid ABAP that abaplint misparses, mistypes or rejects. The compiler's input is code that already
   activates, so these produce wrong native code or refuse a valid program
2. open-abap-core: the pure-ABAP classes an AOT service actually calls (RTTI, JSON, the HTTP server side)
3. abaplint: invalid ABAP that abaplint accepts. Correct to fix, but it barely affects AOT output
4. transpiler: subordinate; its issues matter as cells of the specification, not as JS fixes

### 1. abaplint: valid ABAP mistreated (review on main `af7440a`, 2026-11-23)

All 380 open issues were read; the parser / check_syntax ones run through abaplint (default config, `v757`).

- [ ] **#1809** a macro of the same name in two methods: the second call expands the first definition, `"foo" not
  found`; macros need scoping by position (keyword documentation: a macro is valid from its DEFINE onward). Valid
  code is expanded wrongly
- [ ] `INSERT itab.` parses as InsertDatabase (context-free parser); putting it in the InsertInternal grammar is a
  design question for the abaplint maintainer, not raised. Valid code gets the wrong statement
- [ ] side finding, no issue: `NEW lcl( )->attr = 1.` gives "Not an object reference, target" for any attribute.
  Check first that ABAP accepts it; if so, valid code is rejected
- [ ] dataset statements: #4644 (ENDIAN, TRUNCATE AT POSITION, SET DATASET ATTRIBUTES not parsed) and #4645
  (inline declarations not handled): valid code fails to parse or is mistyped

- in flight: #4329 (`|` and `}` in EXEC SQL or an AMDP body taken as a string template, valid code mis-lexed) is
  in PR abaplint#4684

Suggested order: #1809, then the dataset pair; `INSERT itab.` after asking the abaplint maintainer.

### 2. open-abap-core: what an AOT service calls (TODO review on main `fbc211e`, 2026-11-23)

Its pure-ABAP classes are compiled into AOT binaries as they are; kernel and JS parts do not carry over. A stub
(`ASSERT 1 = 'todo'`) a root can reach is a run-time failure SAP does not have, so the AOT compiler will have to
refuse such a root at build time; every stub implemented removes such a refusal. `grep -rni todo src` (icons
excluded) gives about 350 markers in 82 files: about 280 stub methods, about 30 places that run but are known
incomplete or wrong, 2 placeholder values and a few refactoring notes. Work out the expected behaviour first, as
everywhere in this file.

Most useful for AOT first:
- [ ] RTTI (~10), on the open-DDIC / RTTI path of the design: `get` of `cl_abap_structdescr`/`tabledescr`/`refdescr`
  for some kinds, `get_with_keys`, `get_ddic_object`, `is_instantiatable`, `get_decfloat16`, a `describe_by_data`
  branch. #1348 (`describe_by_data` of decfloat16) belongs here
- [ ] `/ui2/cl_json` (5), what services serialize with: ref to interface, `generate`, some (de)serialize branches,
  `pretty_name` ignored in one path
- [ ] HTTP (~80), the server side first, since `if_http_extension` roots run on request and response entities. Plan
  of 2026-11-23, one PR per step, expected behaviour from public docs only (clean room, never SAP source):
  - [ ] step 1, string functions: `cl_http_utility` `escape_javascript`, `escape_xml_attr_value`,
    `normalize_url`, `get_last_error`; `cl_http_server` static helpers (`escape_url`, `unescape_url`,
    `escape_html`, `encode/decode_base64`, `append_field_url`) delegate to `cl_http_utility`;
    `cl_http_client` `escape_url`, `create_abs_url` (host + `~request_uri`). Fixes of existing methods in PR
    open-abap-core#1352; the new methods follow once it is merged. Gaps raised: #1353 (step 4), #1354
  - [ ] step 2, entity state: `cl_http_entity` gets a cookie table, a version and a table of multipart parts
    (each a `cl_http_entity`); then cookies (`add_cookie_field`, `get_cookie(s)`, `set_cookie`,
    `delete_cookie*`, `get_cookie_field`), header/form-field deletes, `append_data`, `append_cdata`,
    `get_data_length`, `get/set_version`, `get_last_error`, `get/set_authorization`, `get_user_agent`,
    `get_uri_parameter`, `get_form_data`, response `redirect` and `delete_cookie_at_client` as status + headers
  - [ ] step 3, messages and multipart: `to_xstring`/`from_xstring` (start line, CRLF headers, blank line,
    body), then `get_raw_message`, `get_serialized_message_length`, `copy`; multipart `add_multipart`,
    `num_multiparts`, `get_multipart` (parse by `boundary=`, serialize in `to_xstring`)
  - [ ] step 4, client: `send` writes cookies, multipart bodies and form fields (urlencoded POST body, check
    ABAP first); `receive` keeps array headers (`set-cookie` is skipped by `Array.isArray` today) and fills the
    cookies; `refresh_request`; classic exceptions of `create_by_url` (`sy-subrc` forced to 0) once the
    transpiler supports them
  - stay stubs: `create_by_destination`, `cl_web_http_client_manager=>create_by_http_destination` (SM59),
    `create_internal`, server sessions/XSRF/`logoff`/`send_page`/extension info, `server_cache_*`
- [ ] conversions and date/time (~20): `cl_abap_datfm` (`conv_date_int_to_ext`, `conv_period_ext_to_int`),
  `cl_abap_timefm`, `cl_gdt_conversion` (only UTC), codepage replacement character and endian in
  `cl_abap_conv_codepage`/`cl_abap_conv_in_ce`
- [ ] sXML (~20): `cl_sxml_string_reader` only handles JSON, not XML; namespace/path APIs, `set_value*`,
  attribute setters; writer `set_option`, `write_namespace_declaration`, a `json_write_value` branch
- [ ] iXML (~45, `cl_ixml.clas.locals_imp.abap`): filters and filtered iterators, `insert_child`, `get_type`,
  `get_namespace_prefix`, encodings, ostream to itable, parser `get_error`/`num_errors`, `set_declaration`
- [ ] small and self-contained: `cl_bcs_convert` (`string_to_soli/solix`, `solix_to_xstring`, `raw_to_string`),
  `cl_message_helper` (5), `cl_abap_container_utilities`, `cl_abap_exceptional_values`, `cl_abap_gzip` text
  methods, `cl_abap_dyn_prg` (2), ADBC (`commit`/`rollback`/`close`, `get_metadata`, `next_package`,
  `set_param_struct/table`), `SCMS_BINARY_TO_XSTRING`

Known incomplete or wrong (they run), most relevant first:
- [ ] `cl_http_client`: no classic exceptions, `sy-subrc` forced to 0, reason text `'todo_open_abap'` (tests
  assert it)
- [ ] `cl_abap_tstmp` generic packed input "most likely wrong"; two tests commented out (rounding)
- [ ] `cl_abap_elemdescr` ignores `P_LANGU`; `cl_i18n_languages`, `cl_gdt_conversion` do not read DB tables first
- [ ] `cl_abap_regex`: two leftover attributes, a partial feature (line 73)
- [ ] `cl_ixml`: `DEPTH` ignored, two no-ops marked "should this do something?", four `RETURN. " todo`
- [ ] `cl_oo_factory` returns a shared instead of a new instance
- [ ] `cl_abap_random` returns only positive integers
- [ ] placeholders: `SYSTEM_CALLSTACK` gives `'ZTODO'` as program and include; call transformation writes the
  namespace `.../class-pool/TODO`

Not relevant for AOT, not picked up:
- kernel parts (~8: refs in `kernel_ixml_xml_to_data`, `traverse_write` in call transformation, secondary keys in
  `kernel_create_data_handle`), `kernel_call` ("all wrong as the name overlaps"), `kernel_unit_runner` (quit level,
  exception message) and `cl_abap_unit_assert=>abort`: kernel stand-ins and the unit runner do not carry over (the
  AOT compiler generates its test runner)
- `cl_abap_hmac`, `cl_abap_message_digest` "may not work in the browser": a JS host concern
- refactoring notes (out of scope): `cl_abap_typedescr` should be ABSTRACT, some `structdescr`/`tabledescr`
  methods should be private, `cl_sql_result_set` public attributes, a hack in `kernel_call_transformation`, memory
  use of `cl_abap_zip`, optimisations in `/ui2/cl_json`
- stay stubs (SAP server infrastructure, ~80, an environment matter): BCS sending (`cl_bcs`, `cl_document_bcs`,
  `cl_send_request_bcs`, `cl_cam_address_bcs`, `cl_bcs_mail_*`), shared memory (`cl_shm_*`),
  `cl_package_factory`, `cl_mime_repository_api`, `cl_abap_memory_utilities`, most of `cl_http_server`, APC TCP,
  exchange rates, factory/holiday calendars, number ranges, OAuth2 config writer, `DOCU_GET`,
  `CONVERT_ITF_TO_STREAM_TEXT`, `WWW*`

- testing: `npm test` in the open-abap-core root

### 3. abaplint: invalid ABAP accepted

Correct to fix (ABAP is the reference), but it barely affects AOT output, because the compiler's input already
activates on SAP. Lower priority than sections 1 and 2.

check_syntax (no error from abaplint where ABAP is expected to give one):
- [ ] **#2088** rest: assignment to an IMPORTING (by reference) parameter or a constant is reported; `SORT itab`,
  `APPEND ... TO itab` and `CLEAR text` on IMPORTING parameters are not. Overlaps #2097 / #4635 (write positions);
  do it together with #4635
- [ ] **#4683** INTO before WHERE when WHERE has an SQL expression (strict mode): only the `strict_sql`
  rule reports it, and too broadly; add to `strictModeChecks` in `5_syntax/expressions/select.ts`
- [ ] APPEND (and other index operations) to a generic `ANY TABLE` is expected to be an error, abaplint only checks
  hashed; the test "ok, APPEND TO generic tables" still expects no error for `ct_any`
- [ ] **#1692** PRIVATE SECTION of a global class uses a class from `locals_imp`: no error (only the PUBLIC SECTION
  check exists, "is local to the class pool")
- [ ] #895 `CLASS lcl DEFINITION DEFERRED.` and the class never defined
- [ ] #3398 REPORT statement in an include program (SUBC I) that is included in a report
- [ ] #3611 rest: TYPES names over 30 characters (BEGIN OF name, table type) not reported; field names and DATA
  names are
- [ ] #3041 `APPEND INITIAL LINE TO sorted_tab`: the docs suggest a runtime check (ITAB_ILLEGAL_SORT_ORDER); work
  out the expected behaviour before any PR, ask to close if runtime only
- [ ] #4643 DELETE/GET/SET DATASET operands are not checked; `syntax/statements/transfer.ts` looks for a Target
  that the TRANSFER grammar never produces (not raised)

Expected behaviour not worked out yet: #3398, #1692. Dropped: #3414 is an ABAP Cloud issue ("Class ... not
found/released"), and ABAP Cloud is not the reference.


Diagnostics only (no effect on what is accepted):
- [ ] #2267 a statement that does not parse inside a method gives "Expected ENDMETHOD" at the start of the class,
  far from the real error; the maintainer points to the structure rewrite #1975, so probably large

Rules that replace the syntax check (2026-11-23). Some findings that ABAP gives as syntax errors come from rules,
not from check_syntax: they can be switched off, and code that uses SyntaxLogic directly (e.g. downport) does not
see them. Such checks belong in check_syntax. The transpiler already turns on unknown_types, implement_methods and
begin_end_names next to check_syntax (`validation.ts`), so for those three the gain is consistency. Inventory done:
on a snippet for each, check_syntax alone reports nothing and the rule reports it. ABAP is expected to give an
error for:
- unknown_types: unknown type (respects errorNamespace, keep that when moving)
- implement_methods: method or interface method not implemented; ABSTRACT method in a non-abstract class
- method_implemented_twice: METHOD twice; method declared twice
- superclass_final: INHERITING FROM a FINAL class
- begin_end_names: END OF name differs from BEGIN OF; TYPES BEGIN OF without components
- identical_form_names: two FORMs with the same name
- check_include: INCLUDE that does not exist (without IF FOUND)

Not syntax errors, dropped: mix_returning (a Clean ABAP style rule), unhandled_classic_exception (a runtime
error). Not part of the source syntax check, dropped: global_class, cloud_types, local_testclass_consistency.
- [ ] start with one small, clear case as a PR, so the shape (move the check, what happens to the rule) is
  settled in review before the rest follow, once #4690 is answered. Suggested first: identical_form_names or
  superclass_final (small, self-contained)
- note: our own open PRs #4633 and #4636 report through unknown_types; once the approach is agreed, they move too

Non-Unicode-only syntax (2026-11-22). abaplint has no notion of non-Unicode programs: no config setting, the
UCCHECK flag of the program is not read. The grammar accepts old and modern forms together, while the syntax check
assumes Unicode (e.g. byte lengths in `_check_database_work_area.ts`). In modern ABAP every program is Unicode, so
non-Unicode-only forms are expected to be syntax errors; abaplint accepts them for every `syntax.version`. Following
ABAP, this belongs in the parser / check_syntax, not in a rule option.
- [ ] confirmed case: `OPEN DATASET f.` without `FOR ...` and `IN ... MODE`; all OPEN DATASET additions became
  optional in 66bfba641 (#3571). Ask the maintainer whether that was for old code on purpose, then a check
  depending on the release rather than undoing it
- [ ] inventory first: work out the expected behaviour of the usual non-Unicode-only forms (offset/length on
  structures, old DESCRIBE forms, TRANSLATE ... CODE PAGE, ...), compare with abaplint, raise the gaps as issues

Testing note: `npm test`/`--parallel` gives 25-37 "statement type" failures, all 250ms timeouts under load, and a
timeout skips the rest of that file. Serial: `npx mocha --no-config --no-package --recursive build/test/abap/syntax`
(the package.json `spec` overrides a folder argument otherwise)

### 4. transpiler: subordinate

Fixing the JS runtime does not carry over to AOT. What carries over is each issue's snippet and expected behaviour,
which goes into the specification (see the critical path). The items below are kept for that reason; a JS fix PR is
a separate, optional decision per issue.

Specification cells still to work out (formerly "type-by-type review"):
- [ ] p: MOD, DIV, **, compares, ADD/SUBTRACT/..., COLLECT/SORT/READ by p, SELECT/INSERT with p columns, template
  SIGN/NUMBER/STYLE, EXACT, zero divide
- [ ] #1963 int8 to and from x/xstring disagree with ABAP
- [ ] #2139 AS TEXT (SORT, FOR GROUPS, LOOP GROUP BY fixed by #2159/#2161): check whether anything is left and close
- [ ] not reviewed yet: c, string, x, xstring, d, t, utclong (the same list as under the critical path)

JS fixes in flight (optional):
- [ ] #2189 f to i beyond the range (in PR #2218 together with #2192, check what it covers before more PRs):
  CX_SY_CONVERSION_OVERFLOW in the f/decfloat branch of `Integer.set( )` only. The int8 target after #2169 is
  merged (both touch `integer8.ts`); the other sources in the comments (int8, p, text, n to i/int8) as later PRs
  of the same pattern
- [ ] #2259 (raised 2026-11-23) text in scientific notation in arithmetic: calculation type f loses the exponent
  (`'2E1' * '3'` gives 6, 60 expected), p/i give 2 instead of CX_SY_CONVERSION_NO_NUMBER; cause `parseInt` in
  `_parse.ts` and the text-with-Integer shortcuts in add/minus/multiply

Not relevant for AOT, not picked up:
- abaplint#4615 follow-up: `transpile_types.ts` emits ddicName only for Character and Structure, so RTTI
  `is_ddic_type( )` for i, string, n, x and tables needs a transpiler PR (JS runtime only)
- abaplint#4619 follow-up: a transpiler test that `!lines( )` works

- testing: `rm -rf build && npx tsc` in the transpiler root (stale compiled tests of other branches stay in
  `build/` otherwise), then `npx mocha --no-config --no-package --recursive --require source-map-support/register
  build/test`; the 163 "Top level tests, Database" need Postgres and fail locally on every branch
