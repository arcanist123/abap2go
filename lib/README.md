# Built-in library package

An abapGit package that is part of every build's world, next to the packages given with `--input`. It holds the
SAP interfaces that roots implement and that the runtime provides natively, and the exception classes the runtime
raises.

| Object | Source |
|---|---|
| `IF_OO_ADT_CLASSRUN`, `IF_OO_ADT_CLASSRUN_OUT` | [open-abap-core](https://github.com/open-abap/open-abap-core) `src/classrun/` at `133fe9e`, MIT, Copyright (c) 2020 open-abap ([license](../LICENSES/open-abap-core.txt)). The `.intf.xml` files are written here. |
| `CX_ROOT`, `CX_STATIC_CHECK`, `CX_DYNAMIC_CHECK`, `CX_NO_CHECK`, the `CX_SY_*` classes | Written here: the classes `abap2go/abap` raises (`runtime/go/abap/errors.go`, `substring.go`) and their superclasses, as ABAP's class hierarchy has them. Definitions only, without attributes or methods, since `CATCH … INTO` is not compiled yet. |
