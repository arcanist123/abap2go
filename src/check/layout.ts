// What a type is to the statements that work on characters or bytes, and to an offset or length, in a Unicode program.

import * as abaplint from "@abaplint/core";

const { BasicTypes } = abaplint;

type Type = abaplint.AbstractType;
// abaplint's types have private constructors, so a list of them is a list of functions
type Kinds = readonly Function[];

const BYTE_LIKE: Kinds = [BasicTypes.HexType, BasicTypes.XStringType, BasicTypes.XGenericType,
  BasicTypes.XSequenceType];
/** The character-like types of fixed length, and their generic forms. */
const FLAT_CHARACTER: Kinds = [BasicTypes.CharacterType, BasicTypes.CGenericType, BasicTypes.NumericType,
  BasicTypes.NGenericType, BasicTypes.DateType, BasicTypes.TimeType];
/** The generic types that stand for a character-like type among others. */
const MAY_BE_CHARACTER: Kinds = [BasicTypes.CLikeType, BasicTypes.CSequenceType];
const ANY: Kinds = [BasicTypes.AnyType, BasicTypes.DataType, BasicTypes.SimpleType];
const REFERENCE: Kinds = [BasicTypes.DataReference, BasicTypes.ObjectReferenceType,
  BasicTypes.GenericObjectReferenceType];
/** Types that are neither character-like nor byte-like. */
const OTHER: Kinds = [BasicTypes.IntegerType, BasicTypes.Integer8Type, BasicTypes.PackedType, BasicTypes.PGenericType,
  BasicTypes.FloatType, BasicTypes.FloatingPointType, BasicTypes.DecFloatType, BasicTypes.DecFloat16Type,
  BasicTypes.DecFloat34Type, BasicTypes.UTCLongType, BasicTypes.NumericGenericType, BasicTypes.EnumType,
  BasicTypes.TableType, ...REFERENCE];

function isOneOf(type: Type, kinds: Kinds): boolean {
  return kinds.some(kind => type instanceof kind);
}

/**
 * Whether an operand of this type is character-like: c, n, d, t, a flat structure of those only and, unless flat is
 * asked for, string. True for a generic type that may be one, undefined where the type is not known.
 */
export function isCharacterLike(type: Type, flat = false): boolean | undefined {
  if (isOneOf(type, [...FLAT_CHARACTER, ...MAY_BE_CHARACTER, ...ANY])) {
    return true;
  } else if (type instanceof BasicTypes.StringType) {
    return !flat;
  } else if (type instanceof BasicTypes.StructureType) {
    const layout = structureLayout(type);
    return layout === undefined ? undefined : !layout.deep && layout.length !== undefined;
  }
  return isOneOf(type, [...OTHER, ...BYTE_LIKE]) ? false : undefined;
}

/** Whether an operand of this type is byte-like: x or xstring, never a structure. Undefined where not known. */
export function isByteLike(type: Type): boolean | undefined {
  if (isOneOf(type, [...BYTE_LIKE, ...ANY])) {
    return true;
  }
  return isOneOf(type, [...OTHER, ...FLAT_CHARACTER, ...MAY_BE_CHARACTER, BasicTypes.StringType,
    BasicTypes.StructureType]) ? false : undefined;
}

export interface Layout {
  /** a component, at any depth, is a string, a table or a reference */
  readonly deep: boolean;
  /** the length of the character-like initial part: the components of type c, n, d and t before any other */
  readonly characters: number;
  /** the length of the whole structure if it is character-like throughout, else undefined */
  readonly length: number | undefined;
}

/** The layout of a structure, undefined if the type of a component is not known. */
export function structureLayout(structure: abaplint.BasicTypes.StructureType): Layout | undefined {
  let deep = false;
  let characters = 0;
  // no component so far ended the initial part
  let initial = true;
  for (const { type } of structure.getComponents()) {
    if (type instanceof BasicTypes.StructureType) {
      const inner = structureLayout(type);
      if (inner === undefined) {
        return undefined;
      }
      deep ||= inner.deep;
      characters += initial ? inner.characters : 0;
      initial &&= inner.length !== undefined;
      continue;
    }
    const length = characterLength(type);
    if (length !== undefined) {
      characters += initial ? length : 0;
    } else if (isOneOf(type, [BasicTypes.StringType, BasicTypes.XStringType, BasicTypes.TableType, ...REFERENCE])) {
      deep = true;
      initial = false;
    } else if (isOneOf(type, [...OTHER, BasicTypes.HexType])) {
      initial = false;
    } else {
      return undefined;
    }
  }
  return { deep, characters, length: initial ? characters : undefined };
}

/** The length of a field of type c, n, d or t, undefined for any other type. */
export function characterLength(type: Type): number | undefined {
  if (type instanceof BasicTypes.CharacterType || type instanceof BasicTypes.NumericType) {
    return type.getLength();
  } else if (type instanceof BasicTypes.DateType) {
    return 8;
  } else if (type instanceof BasicTypes.TimeType) {
    return 6;
  }
  return undefined;
}
