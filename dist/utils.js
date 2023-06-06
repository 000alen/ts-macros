"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.expressionToStringLiteral = exports.normalizeFunctionNode = exports.deExpandMacroResults = exports.resolveTypeArguments = exports.resolveTypeWithTypeParams = exports.macroParamsToArray = exports.tryRun = exports.fnBodyToString = exports.resolveAliasedSymbol = exports.primitiveToNode = exports.createObject = exports.isStatement = exports.getNameFromProperty = exports.MacroErrorWrapper = exports.MacroError = exports.getRepetitionParams = exports.toBinaryExp = exports.wrapExpressions = exports.flattenBody = void 0;
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
const ts = require("typescript");
function flattenBody(body) {
    if ("statements" in body) {
        return [...body.statements];
    }
    return [ts.factory.createExpressionStatement(body)];
}
exports.flattenBody = flattenBody;
function wrapExpressions(exprs) {
    let last = exprs.pop();
    if (!last)
        return ts.factory.createNull();
    if (exprs.length === 0 && ts.isReturnStatement(last))
        return last.expression || ts.factory.createIdentifier("undefined");
    if (ts.isExpressionStatement(last))
        last = ts.factory.createReturnStatement(last.expression);
    else if (!(last.kind > ts.SyntaxKind.EmptyStatement && last.kind < ts.SyntaxKind.DebuggerStatement))
        last = ts.factory.createReturnStatement(last);
    return ts.factory.createImmediatelyInvokedArrowFunction([...exprs, last]);
}
exports.wrapExpressions = wrapExpressions;
function toBinaryExp(transformer, body, id) {
    let last;
    for (const element of body.map(m => ts.isExpressionStatement(m) ? m.expression : m)) {
        if (!last)
            last = element;
        else
            last = transformer.context.factory.createBinaryExpression(last, id, element);
    }
    return ts.visitNode(last, transformer.boundVisitor);
}
exports.toBinaryExp = toBinaryExp;
function getRepetitionParams(rep) {
    const res = { literals: [] };
    const firstElement = rep.elements[0];
    if (ts.isStringLiteral(firstElement))
        res.separator = firstElement.text;
    else if (ts.isArrayLiteralExpression(firstElement))
        res.literals.push(...firstElement.elements);
    else if (ts.isArrowFunction(firstElement))
        res.function = firstElement;
    const secondElement = rep.elements[1];
    if (secondElement) {
        if (ts.isArrayLiteralExpression(secondElement))
            res.literals.push(...secondElement.elements);
        else if (ts.isArrowFunction(secondElement))
            res.function = secondElement;
    }
    const thirdElement = rep.elements[2];
    if (thirdElement && ts.isArrowFunction(thirdElement))
        res.function = thirdElement;
    if (!res.function)
        throw MacroError(rep, "Repetition must include arrow function.");
    return res;
}
exports.getRepetitionParams = getRepetitionParams;
function MacroError(callSite, msg) {
    MacroErrorWrapper(callSite.pos, callSite.end - callSite.pos, msg, callSite.getSourceFile());
    process.exit();
}
exports.MacroError = MacroError;
function MacroErrorWrapper(start, length, msg, file) {
    if (!ts.sys || typeof process !== "object")
        throw new Error(msg);
    console.error(ts.formatDiagnosticsWithColorAndContext([{
            category: ts.DiagnosticCategory.Error,
            code: 8000,
            file,
            start,
            length,
            messageText: msg
        }], {
        getNewLine: () => "\r\n",
        getCurrentDirectory: ts.sys.getCurrentDirectory,
        getCanonicalFileName: (fileName) => fileName
    }));
}
exports.MacroErrorWrapper = MacroErrorWrapper;
function getNameFromProperty(obj) {
    if (ts.isIdentifier(obj) || ts.isStringLiteral(obj) || ts.isPrivateIdentifier(obj) || ts.isNumericLiteral(obj))
        return obj.text;
    else
        return undefined;
}
exports.getNameFromProperty = getNameFromProperty;
function isStatement(obj) {
    return obj.kind >= ts.SyntaxKind.Block && obj.kind <= ts.SyntaxKind.MissingDeclaration;
}
exports.isStatement = isStatement;
function createObject(record) {
    const assignments = [];
    for (const key in record) {
        const obj = record[key];
        assignments.push(ts.factory.createPropertyAssignment(key, obj ? isStatement(obj) ? ts.factory.createArrowFunction(undefined, undefined, [], undefined, undefined, ts.isBlock(obj) ? obj : ts.factory.createBlock([obj])) : obj : ts.factory.createIdentifier("undefined")));
    }
    return ts.factory.createObjectLiteralExpression(assignments);
}
exports.createObject = createObject;
function primitiveToNode(primitive) {
    if (typeof primitive === "string")
        return ts.factory.createStringLiteral(primitive);
    else if (typeof primitive === "number")
        return ts.factory.createNumericLiteral(primitive);
    else if (typeof primitive === "boolean")
        return primitive ? ts.factory.createTrue() : ts.factory.createFalse();
    else if (primitive === null)
        return ts.factory.createNull();
    else if (Array.isArray(primitive))
        return ts.factory.createArrayLiteralExpression(primitive.map(p => primitiveToNode(p)));
    else {
        const assignments = [];
        for (const key in primitive) {
            assignments.push(ts.factory.createPropertyAssignment(key, primitiveToNode(primitive[key])));
        }
        return ts.factory.createObjectLiteralExpression(assignments);
    }
}
exports.primitiveToNode = primitiveToNode;
function resolveAliasedSymbol(checker, sym) {
    if (!sym)
        return;
    while ((sym.flags & ts.SymbolFlags.Alias) !== 0) {
        const newSym = checker.getAliasedSymbol(sym);
        if (newSym.name === "unknown")
            return sym;
        sym = newSym;
    }
    return sym;
}
exports.resolveAliasedSymbol = resolveAliasedSymbol;
function fnBodyToString(checker, fn) {
    if (!fn.body)
        return "";
    const includedFns = new Set();
    let code = "";
    const visitor = (node) => {
        if (ts.isCallExpression(node)) {
            const signature = checker.getResolvedSignature(node);
            if (signature &&
                signature.declaration &&
                signature.declaration !== fn &&
                signature.declaration.parent.parent !== fn &&
                (ts.isFunctionDeclaration(signature.declaration) ||
                    ts.isArrowFunction(signature.declaration) ||
                    ts.isFunctionExpression(signature.declaration))) {
                const name = signature.declaration.name ? signature.declaration.name.text : ts.isIdentifier(node.expression) ? node.expression.text : undefined;
                if (!name || includedFns.has(name))
                    return;
                includedFns.add(name);
                code += `function ${name}(${signature.parameters.map(p => p.name).join(",")}){${fnBodyToString(checker, signature.declaration)}}`;
            }
            ts.forEachChild(node, visitor);
        }
        else
            ts.forEachChild(node, visitor);
    };
    ts.forEachChild(fn.body, visitor);
    return code + ts.transpile((fn.body.original || fn.body).getText());
}
exports.fnBodyToString = fnBodyToString;
function tryRun(comptime, args = [], additionalMessage) {
    var _a;
    try {
        return comptime(...args);
    }
    catch (err) {
        if (err instanceof Error) {
            const { line, col } = ((_a = (err.stack || "").match(/<anonymous>:(?<line>\d+):(?<col>\d+)/)) === null || _a === void 0 ? void 0 : _a.groups) || {};
            const lineNum = line ? (+line - 1) : 0;
            const colNum = col ? (+col - 1) : 0;
            const file = ts.createSourceFile("comptime", comptime.toString(), ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS);
            const startLoc = ts.getPositionOfLineAndCharacter(file, lineNum, colNum);
            const node = ts.getTokenAtPosition(file, startLoc);
            MacroError(node, (additionalMessage || "") + err.message);
        }
        else
            throw err;
    }
}
exports.tryRun = tryRun;
function macroParamsToArray(params, values) {
    const result = [];
    for (let i = 0; i < params.length; i++) {
        if (params[i].spread)
            result.push(values.slice(i));
        else if (!values[i] && params[i].defaultVal)
            result.push(params[i].defaultVal);
        else
            result.push(values[i]);
    }
    return result;
}
exports.macroParamsToArray = macroParamsToArray;
function resolveTypeWithTypeParams(providedType, typeParams, replacementTypes) {
    const checker = providedType.checker;
    // Access type
    if ("indexType" in providedType && "objectType" in providedType) {
        const indexType = resolveTypeWithTypeParams(providedType.indexType, typeParams, replacementTypes);
        const objectType = resolveTypeWithTypeParams(providedType.objectType, typeParams, replacementTypes);
        const foundType = indexType.isTypeParameter() ? replacementTypes[typeParams.findIndex(t => t === indexType)] : indexType;
        if (!foundType || !foundType.isLiteral())
            return providedType;
        const realType = objectType.getProperty(foundType.value.toString());
        if (!realType)
            return providedType;
        return checker.getTypeOfSymbol(realType);
    }
    // Conditional type
    else if ("checkType" in providedType && "extendsType" in providedType && "resolvedTrueType" in providedType && "resolvedFalseType" in providedType) {
        const checkType = resolveTypeWithTypeParams(providedType.checkType, typeParams, replacementTypes);
        const extendsType = resolveTypeWithTypeParams(providedType.extendsType, typeParams, replacementTypes);
        const trueType = resolveTypeWithTypeParams(providedType.resolvedTrueType, typeParams, replacementTypes);
        const falseType = resolveTypeWithTypeParams(providedType.resolvedFalseType, typeParams, replacementTypes);
        if (checker.isTypeAssignableTo(checkType, extendsType))
            return trueType;
        else
            return falseType;
    }
    // Intersections
    else if (providedType.isIntersection()) {
        const symTable = new Map();
        for (const unresolvedType of providedType.types) {
            const resolved = resolveTypeWithTypeParams(unresolvedType, typeParams, replacementTypes);
            for (const prop of resolved.getProperties()) {
                symTable.set(prop.name, prop);
            }
        }
        return checker.createAnonymousType(undefined, symTable, [], [], []);
    }
    else if (providedType.isTypeParameter())
        return replacementTypes[typeParams.findIndex(t => t === providedType)] || providedType;
    //@ts-expect-error Private API
    else if (providedType.resolvedTypeArguments) {
        const newType = Object.assign({}, providedType);
        //@ts-expect-error Private API
        newType.resolvedTypeArguments = providedType.resolvedTypeArguments.map(arg => resolveTypeWithTypeParams(arg, typeParams, replacementTypes));
        return newType;
    }
    else if (providedType.getCallSignatures().length) {
        const newType = Object.assign({}, providedType);
        const originalCallSignature = providedType.getCallSignatures()[0];
        const callSignature = Object.assign({}, originalCallSignature);
        callSignature.resolvedReturnType = resolveTypeWithTypeParams(originalCallSignature.getReturnType(), typeParams, replacementTypes);
        callSignature.parameters = callSignature.parameters.map(p => {
            if (!p.valueDeclaration || !p.valueDeclaration.type)
                return p;
            const newParam = checker.createSymbol(p.flags, p.escapedName);
            newParam.type = resolveTypeWithTypeParams(checker.getTypeAtLocation(p.valueDeclaration.type), typeParams, replacementTypes);
            return newParam;
        });
        //@ts-expect-error Private API
        newType.callSignatures = [callSignature];
        return newType;
    }
    return providedType;
}
exports.resolveTypeWithTypeParams = resolveTypeWithTypeParams;
function resolveTypeArguments(checker, call) {
    var _a;
    const sig = checker.getResolvedSignature(call);
    if (!sig || !sig.mapper)
        return [];
    switch (sig.mapper.kind) {
        case ts.TypeMapKind.Simple:
            return [sig.mapper.target];
        case ts.TypeMapKind.Array:
            return ((_a = sig.mapper.targets) === null || _a === void 0 ? void 0 : _a.filter(t => t)) || [];
        default:
            return [];
    }
}
exports.resolveTypeArguments = resolveTypeArguments;
/**
 * When a macro gets called, no matter if it's built-in or not, it must expand to a valid expression.
 * If the macro expands to multiple statements, it gets wrapped in an IIFE.
 * This helper function does the opposite, it de-expands the expanded valid expression to an array
 * of statements.
 */
function deExpandMacroResults(nodes) {
    const cloned = [...nodes];
    const lastNode = cloned[nodes.length - 1];
    if (!lastNode)
        return [nodes];
    if (ts.isReturnStatement(lastNode)) {
        const expression = cloned.pop().expression;
        if (!expression)
            return [nodes];
        if (ts.isCallExpression(expression) && ts.isParenthesizedExpression(expression.expression) && ts.isArrowFunction(expression.expression.expression)) {
            const flattened = flattenBody(expression.expression.expression.body);
            let last = flattened.pop();
            if (last && ts.isReturnStatement(last) && last.expression)
                last = last.expression;
            return [[...cloned, ...flattened], last];
        }
        else
            return [cloned, expression];
    }
    return [cloned, cloned[cloned.length - 1]];
}
exports.deExpandMacroResults = deExpandMacroResults;
function normalizeFunctionNode(checker, fnNode) {
    var _a;
    if (ts.isArrowFunction(fnNode) || ts.isFunctionExpression(fnNode) || ts.isFunctionDeclaration(fnNode))
        return fnNode;
    const origin = checker.getSymbolAtLocation(fnNode);
    if (origin && ((_a = origin.declarations) === null || _a === void 0 ? void 0 : _a.length)) {
        const originDecl = origin.declarations[0];
        if (ts.isFunctionLikeDeclaration(originDecl))
            return originDecl;
        else if (ts.isVariableDeclaration(originDecl) && originDecl.initializer && ts.isFunctionLikeDeclaration(originDecl.initializer))
            return originDecl.initializer;
    }
}
exports.normalizeFunctionNode = normalizeFunctionNode;
function expressionToStringLiteral(exp) {
    if (ts.isParenthesizedExpression(exp))
        return expressionToStringLiteral(exp.expression);
    else if (ts.isStringLiteral(exp))
        return exp;
    else if (ts.isIdentifier(exp))
        return ts.factory.createStringLiteral(exp.text);
    else if (ts.isNumericLiteral(exp))
        return ts.factory.createStringLiteral(exp.text);
    else if (exp.kind === ts.SyntaxKind.TrueKeyword)
        return ts.factory.createStringLiteral("true");
    else if (exp.kind === ts.SyntaxKind.FalseKeyword)
        return ts.factory.createStringLiteral("false");
    else
        return ts.factory.createStringLiteral("null");
}
exports.expressionToStringLiteral = expressionToStringLiteral;
