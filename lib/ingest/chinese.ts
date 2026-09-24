import * as OpenCC from "opencc-js";

// Script-side only: the OpenCC dictionaries are large and must not enter the Worker bundle.
const t2s = OpenCC.Converter({ from: "t", to: "cn" });
const s2t = OpenCC.Converter({ from: "cn", to: "tw" });

export const toSimplified = (s: string): string => t2s(s);
export const toTraditional = (s: string): string => s2t(s);
