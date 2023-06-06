import * as ts from "typescript";
import { ComptimeFunction, MacroParam, MacroTransformer } from "./transformer";
export declare function flattenBody(body: ts.ConciseBody): Array<ts.Statement>;
export declare function wrapExpressions(exprs: Array<ts.Statement>): ts.Expression;
export declare function toBinaryExp(transformer: MacroTransformer, body: Array<ts.Node>, id: number): ts.Expression;
export declare function getRepetitionParams(rep: ts.ArrayLiteralExpression): {
    separator?: string;
    literals: Array<ts.Expression>;
    function: ts.ArrowFunction;
};
export declare function MacroError(callSite: ts.Node, msg: string): void;
export declare function MacroErrorWrapper(start: number, length: number, msg: string, file: ts.SourceFile): void;
export declare function getNameFromProperty(obj: ts.PropertyName): string | undefined;
export declare function isStatement(obj: ts.Node): obj is ts.Statement;
export declare function createObject(record: Record<string, ts.Expression | ts.Statement | undefined>): ts.ObjectLiteralExpression;
export declare function primitiveToNode(primitive: unknown): ts.Expression;
export declare function resolveAliasedSymbol(checker: ts.TypeChecker, sym?: ts.Symbol): ts.Symbol | undefined;
export declare function fnBodyToString(checker: ts.TypeChecker, fn: {
    body?: ts.ConciseBody | undefined;
}): string;
export declare function tryRun(comptime: ComptimeFunction, args?: Array<unknown>, additionalMessage?: string): any;
export declare function macroParamsToArray<T>(params: Array<MacroParam>, values: Array<T>): Array<T | Array<T>>;
export declare function resolveTypeWithTypeParams(providedType: ts.Type, typeParams: ts.TypeParameter[], replacementTypes: ts.Type[]): ts.Type;
export declare function resolveTypeArguments(checker: ts.TypeChecker, call: ts.CallExpression): ts.Type[];
/**
 * When a macro gets called, no matter if it's built-in or not, it must expand to a valid expression.
 * If the macro expands to multiple statements, it gets wrapped in an IIFE.
 * This helper function does the opposite, it de-expands the expanded valid expression to an array
 * of statements.
 */
export declare function deExpandMacroResults(nodes: Array<ts.Statement>): [Array<ts.Statement>, ts.Node?];
export declare function normalizeFunctionNode(checker: ts.TypeChecker, fnNode: ts.Expression): ts.FunctionLikeDeclaration | undefined;
export declare function expressionToStringLiteral(exp: ts.Expression): ts.Expression;
