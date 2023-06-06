import * as ts from "typescript";
import { TsMacrosConfig } from ".";
export declare const enum MacroParamMarkers {
    None = 0,
    Accumulator = 1,
    Save = 2
}
export interface MacroParam {
    spread: boolean;
    marker: MacroParamMarkers;
    start: number;
    name: string;
    defaultVal?: ts.Expression;
    realName?: ts.Identifier;
}
export interface Macro {
    name: string;
    params: Array<MacroParam>;
    typeParams: Array<ts.TypeParameterDeclaration>;
    body?: ts.FunctionBody;
    namespace?: ts.ModuleDeclaration;
}
export interface MacroExpand {
    macro: Macro;
    call?: ts.CallExpression;
    args: ts.NodeArray<ts.Expression>;
    defined: Map<string, ts.Identifier>;
    /**
    * The item which has the decorator
    */
    target?: ts.Node;
    store: Map<string, ts.Expression>;
}
export interface MacroRepeat {
    index: number;
    repeatNames: Array<string>;
    elementSlices: Array<Array<ts.Expression>>;
}
export interface MacroTransformerBuiltinProps {
    optimizeEnv?: boolean;
}
export type ComptimeFunction = (...params: Array<unknown>) => void;
export type MacroMap = Map<ts.Symbol, Macro>;
export declare const NO_LIT_FOUND: unique symbol;
export declare class MacroTransformer {
    context: ts.TransformationContext;
    macroStack: Array<MacroExpand>;
    repeat: Array<MacroRepeat>;
    boundVisitor: ts.Visitor;
    props: MacroTransformerBuiltinProps;
    checker: ts.TypeChecker;
    macros: MacroMap;
    escapedStatements: Array<Array<ts.Statement>>;
    comptimeSignatures: Map<ts.Node, ComptimeFunction>;
    config: TsMacrosConfig;
    constructor(context: ts.TransformationContext, checker: ts.TypeChecker, macroMap: MacroMap, config?: TsMacrosConfig);
    run(node: ts.SourceFile): ts.Node;
    visitor(node: ts.Node): ts.VisitResult<ts.Node>;
    execRepetition(fn: ts.ArrowFunction, elements: Array<ts.Expression>, separator?: string, wrapStatements?: boolean): Array<ts.Node>;
    transformFunction(fn: ts.FunctionLikeDeclaration, wrapStatements?: boolean): Array<ts.Node>;
    getMacroParam(name: string, macro: Macro, params: ts.NodeArray<ts.Node>): ts.Node | undefined;
    runMacro(call: ts.CallExpression, name: ts.Expression, target?: ts.Node): Array<ts.Statement> | undefined;
    makeHygienic(statements: ts.NodeArray<ts.Statement>): ts.NodeArray<ts.Statement>;
    getMarker(param: ts.ParameterDeclaration): MacroParamMarkers;
    callComptimeFunction(node: ts.CallExpression | ts.NewExpression): void;
    getNumberFromNode(node: ts.Expression): number | undefined;
    getStringFromNode(node?: ts.Expression, handleIdents?: boolean, handleTemplates?: boolean): string | undefined;
    getLiteralFromNode(node: ts.Expression, handleIdents?: boolean, handleTemplates?: boolean, handleObjects?: boolean): unknown;
    getBoolFromNode(node: ts.Expression | undefined): boolean | undefined;
    resolveTypeArgumentOfCall(macroCall: ts.CallExpression, typeIndex: number): ts.Type | undefined;
    findMacroByTypeParams(prop: ts.PropertyAccessExpression, call: ts.CallExpression): Array<Macro>;
    findMacroByName(node: ts.Node, name: string): Macro | undefined;
    getLastMacro(): MacroExpand | undefined;
    saveAndClearEscapedStatements(into: Array<ts.Statement>): void;
    escapeStatement(...statements: Array<ts.Statement>): void;
    removeEscapeScope(): void;
    addEscapeScope(): void;
    addComptimeSignature(sym: ts.Node, fn: string, args: Array<string>): ComptimeFunction;
    strToAST(str: string): ts.NodeArray<ts.Statement>;
}
