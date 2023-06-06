import ts = require("typescript");
import { MacroTransformer } from "./transformer";
export interface NativeMacro {
    call: (args: ts.NodeArray<ts.Expression>, transformer: MacroTransformer, callSite: ts.CallExpression) => ts.VisitResult<ts.Node>;
    preserveParams?: boolean;
}
declare const _default: Record<string, NativeMacro>;
export default _default;
