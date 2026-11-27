# open-abap roadmap

The work abap2go does in [open-abap-core](https://github.com/open-abap/open-abap-core): a line of work next to the
compiler's in [compiler_roadmap.md](compiler_roadmap.md) and the one in [abaplint_roadmap.md](abaplint_roadmap.md).
This file is the source of its status. Issue and PR numbers belong to open-abap/open-abap-core.

## Rules

- work is listed here to the extent that it moves the AOT compiler
  ([aot_for_abap.md](aot_for_abap.md)) forward
- the work items come after the critical path, the specification of ABAP's rule tables
  ([compiler_roadmap.md](compiler_roadmap.md), "Critical path")
- a gap that the compiler runs into, within the scope it compiles, is fixed right away: offered upstream as a PR. It
  goes before the other work items
- classic modern ABAP is the reference, and the expected behaviour is worked out (keyword documentation) and written
  down as tests before it goes into code or a PR
- nothing that would stop ABAP from compiling ahead of time: nothing that needs a JS host or a compiler at run time
- upstream PRs follow the working rules in [abaplint_roadmap.md](abaplint_roadmap.md), "How a fix gets in": the
  maintainer merges, no update of an open PR without a conflict, other people's issues are not closed by hand
- testing: `npm test` in the open-abap-core root

## Work items

What an AOT service calls (TODO review on main `fbc211e`, 2026-11-23).

Its pure-ABAP classes are compiled into AOT binaries as they are; kernel and JS parts do not carry over. A stub
(`ASSERT 1 = 'todo'`) a root can reach is a run-time failure SAP does not have, so the AOT compiler will have to
refuse such a root at build time; every stub implemented removes such a refusal. `grep -rni todo src` (icons
excluded) gives about 350 markers in 82 files: about 280 stub methods, about 30 places that run but are known
incomplete or wrong, 2 placeholder values and a few refactoring notes.

Most useful for AOT first:
- [ ] RTTI (~10), on the open-DDIC / RTTI path of the design: `get` of `cl_abap_structdescr`/`tabledescr`/`refdescr`
  for some kinds, `get_with_keys`, `get_ddic_object`, `is_instantiatable`, `get_decfloat16`, a `describe_by_data`
  branch. #1348 (`describe_by_data` of decfloat16) belongs here
- [ ] `/ui2/cl_json` (5), what services serialize with: ref to interface, `generate`, some (de)serialize branches,
  `pretty_name` ignored in one path
- [ ] HTTP (~80), the server side first, since `if_http_extension` roots run on request and response entities. Plan
  of 2026-11-23, one PR per step, expected behaviour from public docs only (clean room, never SAP source):
  - [x] step 1, string functions (done 2026-11-25): `cl_http_utility` `escape_javascript`, `escape_xml_attr_value`,
    `normalize_url`, `get_last_error`; `cl_http_server` static helpers (`escape_url`, `unescape_url`,
    `escape_html`, `encode/decode_base64`, `append_field_url`) delegate to `cl_http_utility`;
    `cl_http_client` `escape_url`, `create_abs_url` (host + `~request_uri`). Fixes of existing methods merged as
    open-abap-core#1352, the new methods as open-abap-core#1356. Gaps raised: #1353 (step 4), #1354 (low priority)
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
    cookies; `refresh_request`; classic exceptions of `create_by_url` (`sy-subrc` forced to 0)
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
