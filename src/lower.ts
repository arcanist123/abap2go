import * as abaplint from "@abaplint/core";
import { BuildError } from "./errors";
import { IRRoot } from "./ir";
import { lowerReport } from "./lower_report";
import { lowerClassrun } from "./lower_classrun";

/**
 * Lowers one root to the IR. A root is an executable program or a class implementing IF_OO_ADT_CLASSRUN.
 * Anything not understood is a build error, never a guess.
 */
export function lowerRoot(registry: abaplint.IRegistry, rootName: string): IRRoot {
  const name = rootName.toUpperCase();
  const prog = registry.getObject("PROG", name) as abaplint.Objects.Program | undefined;
  const clas = registry.getObject("CLAS", name) as abaplint.Objects.Class | undefined;
  if (prog !== undefined && clas !== undefined) {
    throw new BuildError(`root ${name}: both a program and a class have this name`);
  } else if (prog !== undefined) {
    return lowerReport(registry, prog);
  } else if (clas !== undefined) {
    return lowerClassrun(registry, clas);
  }
  throw new BuildError(`root ${name}: no program or class of that name in the packages`);
}
