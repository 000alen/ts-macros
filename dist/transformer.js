"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MacroTransformer = exports.NO_LIT_FOUND = void 0;
/* eslint-disable @typescript-eslint/no-non-null-assertion */
const ts = require("typescript");
const nativeMacros_1 = require("./nativeMacros");
const utils_1 = require("./utils");
const actions_1 = require("./actions");
exports.NO_LIT_FOUND = Symbol("NO_LIT_FOUND");
class MacroTransformer {
    constructor(context, checker, macroMap, config) {
        this.context = context;
        this.boundVisitor = this.visitor.bind(this);
        this.repeat = [];
        this.macroStack = [];
        this.escapedStatements = [];
        this.props = {};
        this.checker = checker;
        this.macros = macroMap;
        this.comptimeSignatures = new Map();
        this.config = config || {};
    }
    run(node) {
        if (node.isDeclarationFile)
            return node;
        const statements = [];
        this.addEscapeScope();
        for (const stmt of node.statements) {
            if (ts.isImportDeclaration(stmt) && stmt.importClause) {
                if (stmt.importClause.namedBindings && ts.isNamedImports(stmt.importClause.namedBindings)) {
                    const filtered = stmt.importClause.namedBindings.elements.filter(el => {
                        const sym = (0, utils_1.resolveAliasedSymbol)(this.checker, this.checker.getSymbolAtLocation(el.name));
                        return !sym || (!this.macros.has(sym) && !nativeMacros_1.default[sym.name]);
                    });
                    if (filtered.length)
                        statements.push(ts.factory.updateImportDeclaration(stmt, stmt.modifiers, ts.factory.createImportClause(stmt.importClause.isTypeOnly, undefined, ts.factory.createNamedImports(filtered)), stmt.moduleSpecifier, stmt.assertClause));
                    continue;
                }
                else if (!stmt.importClause.namedBindings && stmt.importClause.name) {
                    const sym = (0, utils_1.resolveAliasedSymbol)(this.checker, this.checker.getSymbolAtLocation(stmt.importClause.name));
                    if (!sym || !this.macros.has(sym))
                        statements.push(stmt);
                    continue;
                }
            }
            const res = this.visitor(stmt);
            this.saveAndClearEscapedStatements(statements);
            if (res) {
                if (Array.isArray(res))
                    statements.push(...res);
                else
                    statements.push(res);
            }
        }
        this.removeEscapeScope();
        return ts.factory.updateSourceFile(node, statements);
    }
    visitor(node) {
        var _a, _b, _c, _d, _e, _f;
        if (ts.isFunctionDeclaration(node) && node.name && !((_a = node.modifiers) === null || _a === void 0 ? void 0 : _a.some(mod => mod.kind === ts.SyntaxKind.DeclareKeyword)) && node.name.getText().startsWith("$")) {
            if (!node.body)
                return node;
            const sym = this.checker.getSymbolAtLocation(node.name);
            if (!sym)
                return node;
            if (this.macros.has(sym))
                return;
            const macroName = sym.name;
            const params = [];
            for (let i = 0; i < node.parameters.length; i++) {
                const param = node.parameters[i];
                if (!ts.isIdentifier(param.name))
                    throw (0, utils_1.MacroError)(param, "You cannot use deconstruction patterns in macros.");
                const marker = this.getMarker(param);
                params.push({
                    spread: Boolean(param.dotDotDotToken),
                    marker,
                    start: i,
                    name: param.name.text,
                    defaultVal: param.initializer || (param.questionToken ? ts.factory.createIdentifier("undefined") : undefined)
                });
            }
            const namespace = ts.isModuleBlock(node.parent) ? node.parent.parent : undefined;
            // There cannot be 2 macros that have the same name and come from the same source file,
            // which means that if the if statement is true, it's very likely the files are being watched
            // for changes and transpiled every time there's a change, so it's a good idea to clean up the
            // macros map for 2 important reasons:
            // - To not excede the max capacity of the map
            // - To allow for macro chaining to work, because it uses macro names only.
            for (const [oldSym, macro] of this.macros) {
                if (macroName === macro.name && ((_b = macro.body) === null || _b === void 0 ? void 0 : _b.getSourceFile().fileName) === node.getSourceFile().fileName && macro.namespace === namespace) {
                    this.macros.delete(oldSym);
                    break;
                }
            }
            this.macros.set(sym, {
                name: macroName,
                params,
                body: node.body,
                typeParams: node.typeParameters || [],
                namespace
            });
            return;
        }
        if (ts.isModuleDeclaration(node) && node.body) {
            const bod = ts.visitNode(node.body, this.boundVisitor);
            if (!bod.statements.length)
                return;
            else
                ts.factory.updateModuleDeclaration(node, node.modifiers, node.name, bod);
        }
        if (ts.isBlock(node)) {
            const statements = [];
            this.addEscapeScope();
            for (const stmt of node.statements) {
                const res = this.visitor(stmt);
                this.saveAndClearEscapedStatements(statements);
                if (res) {
                    if (Array.isArray(res))
                        statements.push(...res);
                    else
                        statements.push(res);
                }
            }
            this.removeEscapeScope();
            return ts.factory.updateBlock(node, statements);
        }
        // Check for macro calls in labels
        if (ts.isLabeledStatement(node)) {
            const macro = this.findMacroByName(node.label, node.label.text);
            if (!macro || !macro.body)
                return;
            let statementNode = node.statement;
            const results = [];
            if (ts.isLabeledStatement(statementNode)) {
                const labelRes = this.visitor(node.statement);
                if (!labelRes)
                    return node;
                else if (Array.isArray(labelRes)) {
                    const foundStmt = labelRes.findIndex(node => actions_1.labelActions[node.kind]);
                    if (foundStmt === -1)
                        return node;
                    results.push(...labelRes.filter((_item, ind) => ind !== foundStmt));
                    statementNode = labelRes[foundStmt];
                }
                else
                    statementNode = ts.visitNode(node.statement, this.boundVisitor);
            }
            const labelAction = actions_1.labelActions[statementNode.kind];
            if (!labelAction)
                return node;
            this.macroStack.push({
                macro,
                call: undefined,
                args: ts.factory.createNodeArray([labelAction(statementNode)]),
                defined: new Map(),
                store: new Map()
            });
            results.push(...ts.visitEachChild(macro.body, this.boundVisitor, this.context).statements);
            const acc = macro.params.find(p => p.marker === 1 /* MacroParamMarkers.Accumulator */);
            if (acc)
                acc.defaultVal = ts.factory.createNumericLiteral(+acc.defaultVal.text + 1);
            this.macroStack.pop();
            return results;
        }
        if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && ts.isNonNullExpression(node.expression.expression)) {
            const statements = this.runMacro(node.expression, node.expression.expression.expression);
            if (!statements)
                return;
            const prepared = this.makeHygienic(ts.factory.createNodeArray(statements));
            if (prepared.length && ts.isReturnStatement(prepared[prepared.length - 1]) && ts.isSourceFile(node.parent)) {
                const exp = prepared.pop();
                if (exp.expression)
                    prepared.push(ts.factory.createExpressionStatement(exp.expression));
            }
            else
                return prepared;
        }
        if (ts.canHaveDecorators(node) && ((_c = ts.getDecorators(node)) === null || _c === void 0 ? void 0 : _c.length)) {
            const decorators = ts.getDecorators(node);
            let prev;
            const extra = [];
            for (let i = decorators.length - 1; i >= 0; i--) {
                const decorator = decorators[i];
                if (ts.isCallExpression(decorator.expression) && ts.isNonNullExpression(decorator.expression.expression)) {
                    const res = this.runMacro(decorator.expression, decorator.expression.expression.expression, prev || decorator.parent);
                    if (res && res.length) {
                        const [deExpanded, last] = (0, utils_1.deExpandMacroResults)(res);
                        if (last)
                            prev = ts.visitNode(last, this.boundVisitor);
                        extra.push(...deExpanded);
                    }
                }
            }
            if (prev)
                return [...extra, prev];
        }
        if (ts.isCallExpression(node)) {
            if (ts.isNonNullExpression(node.expression)) {
                const statements = this.runMacro(node, node.expression.expression);
                if (!statements || !statements.length)
                    return ts.factory.createNull();
                let last = statements.pop();
                if (statements.length === 0) {
                    if (ts.isReturnStatement(last) || ts.isExpressionStatement(last))
                        return last.expression;
                    else if (!(0, utils_1.isStatement)(last))
                        return last;
                }
                if (ts.isExpressionStatement(last))
                    last = ts.factory.createReturnStatement(last.expression);
                else if (!(0, utils_1.isStatement)(last))
                    last = ts.factory.createReturnStatement(last);
                return ts.factory.createCallExpression(ts.factory.createParenthesizedExpression(ts.factory.createArrowFunction(undefined, undefined, [], undefined, undefined, ts.factory.createBlock([...statements, last], true))), undefined, undefined);
            }
            else
                this.callComptimeFunction(node);
        }
        if (ts.isNewExpression(node))
            this.callComptimeFunction(node);
        // If this is true then we're in the context of a macro call
        if (this.macroStack.length) {
            const { macro, args, store } = this.getLastMacro();
            // Detects property / element access and tries to remove it if possible
            if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
                if (ts.isPropertyAccessExpression(node) && this.props.optimizeEnv && node.expression.getText() === "process.env") {
                    const value = process.env[node.name.text];
                    if (!value)
                        return node;
                    return ts.factory.createStringLiteral(value);
                }
                else {
                    let exp = ts.visitNode(node.expression, this.boundVisitor);
                    while (ts.isParenthesizedExpression(exp))
                        exp = exp.expression;
                    if (ts.isObjectLiteralExpression(exp)) {
                        const name = ts.isPropertyAccessExpression(node) ? (0, utils_1.getNameFromProperty)(node.name) : this.getNumberFromNode(ts.visitNode(node.argumentExpression, this.boundVisitor));
                        if (!name)
                            return node;
                        const prop = exp.properties.find(p => p.name && ((0, utils_1.getNameFromProperty)(p.name) === name));
                        if (prop && ts.isPropertyAssignment(prop))
                            return prop.initializer;
                        return ts.factory.createPropertyAccessExpression(exp, name.toString());
                    }
                    else if (ts.isArrayLiteralExpression(exp)) {
                        if (!ts.isElementAccessExpression(node))
                            return ts.factory.createPropertyAccessExpression(exp, node.name);
                        const nameNode = ts.visitNode(node.argumentExpression, this.boundVisitor);
                        const name = this.getNumberFromNode(nameNode);
                        if (name !== undefined && exp.elements[name])
                            return exp.elements[name];
                        return ts.factory.createElementAccessExpression(exp, nameNode);
                    }
                }
            }
            else if (ts.isAsExpression(node))
                return ts.visitNode(node.expression, this.boundVisitor);
            else if (ts.isNonNullExpression(node))
                return ts.visitNode(node.expression, this.boundVisitor);
            else if (ts.isNumericLiteral(node))
                return ts.factory.createNumericLiteral(node.text);
            else if (ts.isStringLiteral(node))
                return ts.factory.createStringLiteral(node.text);
            else if (ts.isRegularExpressionLiteral(node))
                return ts.factory.createRegularExpressionLiteral(node.text);
            else if (ts.isTemplateHead(node))
                return ts.factory.createTemplateHead(node.text, node.rawText, node.templateFlags);
            else if (ts.isTemplateMiddle(node))
                return ts.factory.createTemplateMiddle(node.text, node.rawText, node.templateFlags);
            else if (ts.isTemplateTail(node))
                return ts.factory.createTemplateTail(node.text, node.rawText, node.templateFlags);
            // Detects use of a macro parameter and replaces it with a literal
            else if (ts.isIdentifier(node)) {
                if (store.has(node.text))
                    return store.get(node.text);
                const paramMacro = this.getMacroParam(node.text, macro, args);
                if (!paramMacro)
                    return node;
                if (ts.isStringLiteral(paramMacro) && (ts.isClassDeclaration(node.parent) || ts.isEnumDeclaration(node.parent) || ts.isFunctionDeclaration(node.parent)))
                    return ts.factory.createIdentifier(paramMacro.text);
                if (ts.isIdentifier(paramMacro))
                    return paramMacro;
                return ts.visitNode(paramMacro, this.boundVisitor);
            }
            else if (ts.isVariableStatement(node)) {
                const leftovers = [];
                for (const varNode of node.declarationList.declarations) {
                    if (ts.isIdentifier(varNode.name) && varNode.name.text.startsWith("$")) {
                        store.set(varNode.name.text, ts.visitNode(varNode.initializer, this.boundVisitor) || ts.factory.createIdentifier("undefined"));
                    }
                    else {
                        leftovers.push(ts.visitNode(varNode, this.boundVisitor));
                    }
                }
                if (leftovers.length)
                    return ts.factory.createVariableStatement(node.modifiers, ts.factory.createVariableDeclarationList(leftovers, node.declarationList.flags));
                else
                    return undefined;
            }
            else if (ts.isArrayLiteralExpression(node) && node.elements.some(t => ts.isSpreadElement(t))) {
                const elements = [];
                for (const element of node.elements) {
                    if (ts.isSpreadElement(element)) {
                        const visited = ts.visitNode(element.expression, this.boundVisitor);
                        if (ts.isArrayLiteralExpression(visited))
                            elements.push(...visited.elements);
                        else
                            elements.push(ts.visitNode(element, this.boundVisitor));
                    }
                    else
                        elements.push(ts.visitNode(element, this.boundVisitor));
                }
                return ts.factory.createArrayLiteralExpression(elements);
            }
            // Detects a ternary expression and tries to remove it if possible
            else if (ts.isConditionalExpression(node)) {
                const param = ts.visitNode(node.condition, this.boundVisitor);
                const res = this.getBoolFromNode(param);
                if (res === false)
                    return ts.visitNode(node.whenFalse, this.boundVisitor);
                else if (res === true)
                    return ts.visitNode(node.whenTrue, this.boundVisitor);
                else
                    return ts.factory.createConditionalExpression(param, undefined, ts.visitNode(node.whenTrue, this.boundVisitor), undefined, ts.visitNode(node.whenFalse, this.boundVisitor));
            }
            // Detects an if statement and tries to remove it if possible
            else if (ts.isIfStatement(node) && !ts.isParenthesizedExpression(node.expression)) {
                const condition = ts.visitNode(node.expression, this.boundVisitor);
                const res = this.getBoolFromNode(condition);
                if (res === true) {
                    const res = ts.visitNode(node.thenStatement, this.boundVisitor);
                    if (res && ts.isBlock(res))
                        return [...res.statements];
                    return res;
                }
                else if (res === false) {
                    if (!node.elseStatement)
                        return undefined;
                    const res = ts.visitNode(node.elseStatement, this.boundVisitor);
                    if (res && ts.isBlock(res))
                        return [...res.statements];
                    return res;
                }
                return ts.factory.createIfStatement(condition, ts.visitNode(node.thenStatement, this.boundVisitor), ts.visitNode(node.elseStatement, this.boundVisitor));
            }
            // Detects a binary operation and tries to remove it if possible
            else if (ts.isBinaryExpression(node)) {
                const op = node.operatorToken.kind;
                const left = ts.visitNode(node.left, this.boundVisitor);
                const right = ts.visitNode(node.right, this.boundVisitor);
                const leftVal = this.getLiteralFromNode(left);
                const rightVal = this.getLiteralFromNode(right);
                if (leftVal === exports.NO_LIT_FOUND || rightVal === exports.NO_LIT_FOUND)
                    return ts.factory.createBinaryExpression(left, op, right);
                if (actions_1.binaryNumberActions[op] && typeof leftVal === "number" && typeof rightVal === "number")
                    return actions_1.binaryNumberActions[op](leftVal, rightVal);
                else
                    return (_e = (_d = actions_1.binaryActions[op]) === null || _d === void 0 ? void 0 : _d.call(actions_1.binaryActions, left, right, leftVal, rightVal)) !== null && _e !== void 0 ? _e : ts.factory.createBinaryExpression(left, op, right);
            }
            // Detects a typeof expression and tries to remove it if possible
            else if (ts.isTypeOfExpression(node)) {
                const visitedNode = ts.visitNode(node.expression, this.boundVisitor);
                const val = this.getLiteralFromNode(visitedNode);
                if (val === exports.NO_LIT_FOUND)
                    return ts.factory.updateTypeOfExpression(node, visitedNode);
                return ts.factory.createStringLiteral(typeof val);
            }
            // Detects a repetition
            else if (ts.isExpressionStatement(node) && ts.isPrefixUnaryExpression(node.expression) && node.expression.operator === 39 && ts.isArrayLiteralExpression(node.expression.operand)) {
                const { separator, function: fn, literals } = (0, utils_1.getRepetitionParams)(node.expression.operand);
                return this.execRepetition(fn, literals, separator);
            }
            else if (ts.isPrefixUnaryExpression(node)) {
                if (node.operator === 39 && ts.isArrayLiteralExpression(node.operand)) {
                    const { separator, function: fn, literals } = (0, utils_1.getRepetitionParams)(node.operand);
                    if (!separator)
                        throw (0, utils_1.MacroError)(node, "Repetition separator must be included if a repetition is used as an expression.");
                    return this.execRepetition(fn, literals, separator, true);
                }
                else {
                    // Detects a unary expression and tries to remove it if possible
                    const op = node.operator;
                    const value = ts.visitNode(node.operand, this.boundVisitor);
                    const val = this.getLiteralFromNode(value);
                    if (val === exports.NO_LIT_FOUND)
                        return ts.factory.createPrefixUnaryExpression(node.operator, value);
                    return ((_f = actions_1.unaryActions[op]) === null || _f === void 0 ? void 0 : _f.call(actions_1.unaryActions, val)) || value;
                }
            }
            else if (ts.isCallExpression(node)) {
                const repNodeIndex = node.arguments.findIndex(arg => ts.isPrefixUnaryExpression(arg) && arg.operator === 39 && ts.isArrayLiteralExpression(arg.operand));
                if (repNodeIndex !== -1) {
                    const repNode = node.arguments[repNodeIndex].operand;
                    const { separator, function: fn, literals } = (0, utils_1.getRepetitionParams)(repNode);
                    if (!separator) {
                        const newBod = this.execRepetition(fn, literals, separator, true);
                        const finalArgs = [];
                        for (let i = 0; i < node.arguments.length; i++) {
                            if (i === repNodeIndex)
                                finalArgs.push(...newBod);
                            else
                                finalArgs.push(node.arguments[i]);
                        }
                        return ts.visitNode(ts.factory.createCallExpression(node.expression, node.typeArguments, finalArgs), this.boundVisitor);
                    }
                }
            }
            return ts.visitEachChild(node, this.boundVisitor, this.context);
        }
        return ts.visitEachChild(node, this.boundVisitor, this.context);
    }
    execRepetition(fn, elements, separator, wrapStatements) {
        const newBod = [];
        const repeatNames = fn.parameters.map(p => p.name.getText());
        const elementSlices = Array.from({ length: repeatNames.length }, () => []);
        let totalLoopsNeeded = 0;
        for (let i = 0; i < elements.length; i++) {
            const lit = elements[i];
            const resolved = ts.visitNode(lit, this.boundVisitor);
            if (ts.isArrayLiteralExpression(resolved)) {
                if (resolved.elements.length > totalLoopsNeeded)
                    totalLoopsNeeded = resolved.elements.length;
                elementSlices[i % repeatNames.length].push(...resolved.elements);
            }
        }
        if (!totalLoopsNeeded)
            return [ts.factory.createNull()];
        const ind = this.repeat.push({
            index: 0,
            elementSlices,
            repeatNames
        }) - 1;
        for (; this.repeat[ind].index < totalLoopsNeeded; this.repeat[ind].index++) {
            newBod.push(...this.transformFunction(fn, wrapStatements));
        }
        this.repeat.pop();
        return separator && separators[separator] ? [separators[separator](this, newBod)] : newBod;
    }
    transformFunction(fn, wrapStatements) {
        if (!fn.body)
            return [];
        const newBod = [];
        if ("statements" in fn.body) {
            if (wrapStatements)
                newBod.push((0, utils_1.wrapExpressions)(fn.body.statements.map(node => ts.visitNode(node, this.boundVisitor)).filter(el => el)));
            else {
                for (const stmt of fn.body.statements) {
                    const res = this.boundVisitor(stmt);
                    if (res) {
                        if (Array.isArray(res))
                            newBod.push(...res);
                        else
                            newBod.push(res);
                    }
                }
            }
        }
        else {
            const res = ts.visitNode(fn.body, this.boundVisitor);
            newBod.push(res);
        }
        return newBod;
    }
    getMacroParam(name, macro, params) {
        const index = macro.params.findIndex(p => p.name === name);
        if (index === -1) {
            for (let i = this.repeat.length - 1; i >= 0; i--) {
                const repeat = this.repeat[i];
                const repeatNameIndex = repeat.repeatNames.indexOf(name);
                if (repeatNameIndex !== -1) {
                    const repeatCollection = repeat.elementSlices[repeatNameIndex];
                    if (repeatCollection.length <= repeat.index)
                        return ts.factory.createNull();
                    else
                        return repeatCollection[repeat.index];
                }
            }
            return;
        }
        const paramMacro = macro.params[index];
        if (paramMacro.realName)
            return paramMacro.realName;
        if (paramMacro.spread) {
            const spreadItems = params.slice(paramMacro.start);
            if (spreadItems.length === 1 && ts.isSpreadElement(spreadItems[0]))
                return spreadItems[0].expression;
            else
                return ts.factory.createArrayLiteralExpression(params.slice(paramMacro.start));
        }
        return params[paramMacro.start] || paramMacro.defaultVal;
    }
    runMacro(call, name, target) {
        var _a;
        const args = call.arguments;
        let macro, normalArgs;
        if (ts.isPropertyAccessExpression(name)) {
            const symofArg = (0, utils_1.resolveAliasedSymbol)(this.checker, this.checker.getSymbolAtLocation(name.expression));
            if (symofArg && (symofArg.flags & ts.SymbolFlags.Namespace) !== 0)
                return this.runMacro(call, name.name);
            const possibleMacros = this.findMacroByTypeParams(name, call);
            if (!possibleMacros.length)
                throw (0, utils_1.MacroError)(call, `No possible candidates for "${name.name.getText()}" call`);
            else if (possibleMacros.length > 1)
                throw (0, utils_1.MacroError)(call, `More than one possible candidate for "${name.name.getText()}" call`);
            else
                macro = possibleMacros[0];
            const newArgs = ts.factory.createNodeArray([ts.visitNode(name.expression, this.boundVisitor), ...call.arguments]);
            normalArgs = this.macroStack.length ? ts.visitNodes(newArgs, this.boundVisitor) : newArgs;
        }
        else {
            const nativeMacro = nativeMacros_1.default[name.getText()];
            if (nativeMacro) {
                const macroResult = nativeMacro.call(nativeMacro.preserveParams ? args : ts.visitNodes(args, this.boundVisitor), this, call);
                if (!macroResult)
                    return undefined;
                if (Array.isArray(macroResult))
                    return macroResult;
                return [ts.factory.createExpressionStatement(macroResult)];
            }
            macro = this.macros.get((0, utils_1.resolveAliasedSymbol)(this.checker, this.checker.getSymbolAtLocation(name)));
            normalArgs = this.macroStack.length ? ts.visitNodes(args, this.boundVisitor) : args;
        }
        if (!macro || !macro.body) {
            const calledSym = (0, utils_1.resolveAliasedSymbol)(this.checker, this.checker.getSymbolAtLocation(name));
            if ((_a = calledSym === null || calledSym === void 0 ? void 0 : calledSym.declarations) === null || _a === void 0 ? void 0 : _a.length) {
                this.boundVisitor(calledSym.declarations[0]);
                return this.runMacro(call, name, target);
            }
            else {
                return;
            }
        }
        this.macroStack.push({
            macro,
            args: normalArgs,
            call: call,
            target,
            defined: new Map(),
            store: new Map()
        });
        const pre = [];
        for (let i = 0; i < macro.params.length; i++) {
            const param = macro.params[i];
            if (param.marker === 2 /* MacroParamMarkers.Save */) {
                const value = param.spread ? ts.factory.createArrayLiteralExpression(normalArgs.slice(param.start)) : (normalArgs[param.start] || param.defaultVal);
                if (!ts.isIdentifier(value)) {
                    param.realName = ts.factory.createUniqueName(param.name);
                    pre.push(ts.factory.createVariableDeclaration(param.realName, undefined, undefined, value));
                }
            }
        }
        if (pre.length)
            this.escapeStatement(ts.factory.createVariableStatement(undefined, ts.factory.createVariableDeclarationList(pre, ts.NodeFlags.Let)));
        const result = ts.visitEachChild(macro.body, this.boundVisitor, this.context).statements;
        const acc = macro.params.find(p => p.marker === 1 /* MacroParamMarkers.Accumulator */);
        if (acc)
            acc.defaultVal = ts.factory.createNumericLiteral(+acc.defaultVal.text + 1);
        this.macroStack.pop();
        return [...result];
    }
    makeHygienic(statements) {
        var _a;
        const defined = ((_a = this.getLastMacro()) === null || _a === void 0 ? void 0 : _a.defined) || new Map();
        const makeBindingElementHygienic = (name) => {
            if (ts.isIdentifier(name)) {
                const newName = ts.factory.createUniqueName(name.text);
                defined.set(name.text, newName);
                return newName;
            }
            else if (ts.isArrayBindingPattern(name))
                return ts.factory.createArrayBindingPattern(name.elements.map(el => ts.isBindingElement(el) ? ts.factory.createBindingElement(el.dotDotDotToken, el.propertyName, makeBindingElementHygienic(el.name), ts.visitNode(el.initializer, visitor)) : el));
            else if (ts.isObjectBindingPattern(name))
                return ts.factory.createObjectBindingPattern(name.elements.map(el => ts.factory.createBindingElement(el.dotDotDotToken, el.propertyName, makeBindingElementHygienic(el.name), ts.visitNode(el.initializer, visitor))));
            else
                return name;
        };
        const visitor = (node) => {
            if (ts.isVariableDeclaration(node) && node.pos !== -1) {
                return ts.factory.updateVariableDeclaration(node, makeBindingElementHygienic(node.name), undefined, undefined, ts.visitNode(node.initializer, visitor));
            }
            else if (ts.isIdentifier(node)) {
                if (node.parent && ts.isPropertyAccessExpression(node.parent) && node.parent.expression !== node)
                    return node;
                else
                    return defined.get(node.text) || node;
            }
            else
                return ts.visitEachChild(node, visitor, this.context);
        };
        return ts.visitNodes(ts.factory.createNodeArray(statements), visitor);
    }
    getMarker(param) {
        if (!param.type)
            return 0 /* MacroParamMarkers.None */;
        const type = this.checker.getTypeAtLocation(param.type).getProperty("__marker");
        if (!type)
            return 0 /* MacroParamMarkers.None */;
        const typeOfMarker = this.checker.getTypeOfSymbol(type).getNonNullableType();
        if (!typeOfMarker.isStringLiteral())
            return 0 /* MacroParamMarkers.None */;
        switch (typeOfMarker.value) {
            case "Accumulator": return 1 /* MacroParamMarkers.Accumulator */;
            case "Save": return 2 /* MacroParamMarkers.Save */;
            default: return 0 /* MacroParamMarkers.None */;
        }
    }
    callComptimeFunction(node) {
        var _a;
        // Handle comptime signatures
        if (this.comptimeSignatures.size) {
            const signature = this.checker.getResolvedSignature(node);
            if (signature && signature.declaration) {
                const func = this.comptimeSignatures.get(signature.declaration);
                if (func) {
                    (0, utils_1.tryRun)(func, ((_a = node.arguments) === null || _a === void 0 ? void 0 : _a.map(arg => {
                        const lit = this.getLiteralFromNode(arg, false, true, true);
                        if (lit === exports.NO_LIT_FOUND)
                            return undefined;
                        else
                            return lit;
                    })) || []);
                }
            }
        }
    }
    getNumberFromNode(node) {
        if (ts.isParenthesizedExpression(node))
            return this.getNumberFromNode(node.expression);
        if (ts.isNumericLiteral(node))
            return +node.text;
        const type = this.checker.getTypeAtLocation(node);
        if (type.isNumberLiteral())
            return type.value;
        //@ts-expect-error Private API
        if (type.intrinsicName === "null")
            return 0;
    }
    getStringFromNode(node, handleIdents = false, handleTemplates = false) {
        if (!node)
            return;
        const lit = this.getLiteralFromNode(node, handleIdents, handleTemplates);
        if (typeof lit === "string")
            return lit;
        return undefined;
    }
    getLiteralFromNode(node, handleIdents = false, handleTemplates = false, handleObjects = false) {
        if (ts.isParenthesizedExpression(node))
            return this.getLiteralFromNode(node.expression);
        else if (ts.isAsExpression(node))
            return this.getLiteralFromNode(node.expression);
        else if (ts.isNumericLiteral(node))
            return +node.text;
        else if (ts.isStringLiteral(node))
            return node.text;
        else if (node.kind === ts.SyntaxKind.FalseKeyword)
            return false;
        else if (node.kind === ts.SyntaxKind.TrueKeyword)
            return true;
        else if (node.kind === ts.SyntaxKind.NullKeyword)
            return null;
        else if (ts.isIdentifier(node)) {
            if (node.text === "undefined")
                return undefined;
            else if (handleIdents)
                return node.text;
        }
        else if (handleTemplates && ts.isTemplateExpression(node)) {
            let res = node.head.text;
            for (const span of node.templateSpans) {
                const lit = this.getLiteralFromNode(ts.visitNode(span.expression, this.boundVisitor));
                res += (lit || "").toString() + span.literal.text;
            }
            return res;
        }
        else if (handleObjects && ts.isObjectLiteralExpression(node)) {
            const obj = {};
            for (const prop of node.properties) {
                if (!ts.isPropertyAssignment(prop) || !prop.initializer)
                    continue;
                const name = prop.name && (0, utils_1.getNameFromProperty)(prop.name);
                if (!name)
                    continue;
                obj[name] = this.getLiteralFromNode(prop.initializer, handleIdents, handleTemplates, handleObjects);
            }
            return obj;
        }
        else if (handleObjects && ts.isArrayLiteralExpression(node))
            return node.elements.map(el => this.getLiteralFromNode(el, handleIdents, handleTemplates, handleObjects));
        const type = this.checker.getTypeAtLocation(node);
        if (type.isNumberLiteral())
            return type.value;
        else if (type.isStringLiteral())
            return type.value;
        //@ts-expect-error Private API
        else if (type.value)
            return type.value;
        //@ts-expect-error Private API
        else if (type.intrinsicName === "false")
            return false;
        //@ts-expect-error Private API
        else if (type.intrinsicName === "true")
            return true;
        //@ts-expect-error Private API
        else if (type.intrinsicName === "undefined")
            return undefined;
        //@ts-expect-error Private API
        else if (type.intrinsicName === "null")
            return null;
        else
            return exports.NO_LIT_FOUND;
    }
    getBoolFromNode(node) {
        if (!node)
            return undefined;
        if (node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword)
            return false;
        else if (node.kind === ts.SyntaxKind.TrueKeyword)
            return true;
        else if (ts.isNumericLiteral(node)) {
            if (node.text === "0")
                return false;
            return true;
        }
        else if (ts.isStringLiteral(node)) {
            if (node.text === "")
                return false;
            return true;
        }
        else if (ts.isArrayLiteralExpression(node) || ts.isObjectLiteralElement(node))
            return true;
        else if (ts.isIdentifier(node) && node.text === "undefined")
            return false;
        const type = this.checker.getTypeAtLocation(node);
        if (type.isNumberLiteral()) {
            if (type.value === 0)
                return false;
            return true;
        }
        else if (type.isStringLiteral()) {
            if (type.value === "")
                return false;
            return true;
        }
        else if (type.getCallSignatures().length)
            return true;
        //@ts-expect-error Private API
        else if (type.intrinsicName === "false")
            return false;
        //@ts-expect-error Private API
        else if (type.intrinsicName === "true")
            return true;
        //@ts-expect-error Private API
        else if (type.intrinsicName === "undefined")
            return false;
        //@ts-expect-error Private API
        else if (type.intrinsicName === "null")
            return false;
        return undefined;
    }
    resolveTypeArgumentOfCall(macroCall, typeIndex) {
        var _a, _b;
        if (!macroCall.typeArguments || !macroCall.typeArguments[typeIndex])
            return;
        const type = this.checker.getTypeAtLocation(macroCall.typeArguments[typeIndex]);
        const lastMacroCall = this.getLastMacro();
        if (!lastMacroCall)
            return type;
        if (type.isTypeParameter()) {
            const resolvedTypeParameterIndex = lastMacroCall.macro.typeParams.findIndex(arg => this.checker.getTypeAtLocation(arg) === type);
            if (resolvedTypeParameterIndex === -1)
                return;
            if (lastMacroCall.call) {
                const resolvedTypeParam = (_a = lastMacroCall.call.typeArguments) === null || _a === void 0 ? void 0 : _a[resolvedTypeParameterIndex];
                if (!resolvedTypeParam)
                    return (_b = this.checker.getResolvedSignature(lastMacroCall.call)) === null || _b === void 0 ? void 0 : _b.getTypeParameterAtPosition(resolvedTypeParameterIndex);
                return this.checker.getTypeAtLocation(resolvedTypeParam);
            }
            else
                return;
        }
        else {
            const allParams = lastMacroCall.macro.typeParams.map(p => this.checker.getTypeAtLocation(p));
            const replacementTypes = (0, utils_1.resolveTypeArguments)(this.checker, lastMacroCall.call);
            return (0, utils_1.resolveTypeWithTypeParams)(type, allParams, replacementTypes);
        }
    }
    findMacroByTypeParams(prop, call) {
        const name = prop.name.getText();
        const firstType = this.checker.getTypeAtLocation(prop.expression);
        const restTypes = call.arguments.map((exp) => this.checker.getTypeAtLocation(exp));
        const macros = [];
        mainLoop: for (const [sym, macro] of this.macros) {
            // If the names are different, continue to the next macro
            if (macro.name !== name)
                continue;
            const fnType = this.checker.getTypeOfSymbolAtLocation(sym, sym.valueDeclaration).getCallSignatures()[0];
            const fnTypeParams = macro.typeParams.map(p => this.checker.getTypeAtLocation(p));
            const anyArray = fnTypeParams.map(p => p.getConstraint() || this.checker.getAnyType());
            const fnArgs = fnTypeParams.length ? fnType.parameters.map(p => (0, utils_1.resolveTypeWithTypeParams)(this.checker.getTypeOfSymbolAtLocation(p, p.valueDeclaration), fnTypeParams, anyArray)) : fnType.parameters.map(p => this.checker.getTypeOfSymbolAtLocation(p, p.valueDeclaration));
            const firstArg = fnArgs.shift();
            // If the first parameter matches type
            if (this.checker.isTypeAssignableTo(firstType, firstArg)) {
                // Check if the rest of the parameters match
                for (let i = 0; i < fnArgs.length; i++) {
                    // If the parameter is spread, do not compare, it will be done afterwards
                    if (macro.params[i + 1].spread)
                        break;
                    // If the macro call is missing a parameter
                    // and that parameter is NOT optional and does NOT have a default value
                    // continue to the next macro
                    if (!restTypes[i]) {
                        if (fnArgs[i].getDefault() || fnArgs[i] !== fnArgs[i].getNonNullableType())
                            continue;
                        else
                            continue mainLoop;
                    }
                    if (!this.checker.isTypeAssignableTo(restTypes[i], fnArgs[i]))
                        continue mainLoop;
                }
                // If the macro call has more arguments than the macro declaration
                if (restTypes.length > fnArgs.length) {
                    // If the last parameter of the function is a spread parameter, check if the rest of the
                    // passed values match the type, otherwise return
                    let argType = this.checker.getTypeArguments(fnArgs[fnArgs.length - 1])[0];
                    if (argType.isTypeParameter())
                        argType = argType.getConstraint() || this.checker.getAnyType();
                    if (macro.params[macro.params.length - 1].spread) {
                        for (let i = fnArgs.length - 1; i < restTypes.length; i++) {
                            if (!this.checker.isTypeAssignableTo(restTypes[i], argType))
                                continue mainLoop;
                        }
                    }
                    else
                        continue;
                }
                macros.push(macro);
            }
        }
        return macros;
    }
    findMacroByName(node, name) {
        const foundMacros = [];
        for (const [, macro] of this.macros) {
            if (macro.name === name)
                foundMacros.push(macro);
        }
        if (foundMacros.length > 1)
            throw (0, utils_1.MacroError)(node, `More than one macro with the name ${name} exists.`);
        return foundMacros[0];
    }
    getLastMacro() {
        return this.macroStack[this.macroStack.length - 1];
    }
    saveAndClearEscapedStatements(into) {
        into.push(...this.escapedStatements[this.escapedStatements.length - 1]);
        this.escapedStatements[this.escapedStatements.length - 1].length = 0;
    }
    escapeStatement(...statements) {
        this.escapedStatements[this.escapedStatements.length - 1].push(...statements);
    }
    removeEscapeScope() {
        this.escapedStatements.pop();
    }
    addEscapeScope() {
        this.escapedStatements.push([]);
    }
    addComptimeSignature(sym, fn, args) {
        if (this.comptimeSignatures.has(sym))
            return this.comptimeSignatures.get(sym);
        const comptime = new Function(...args, fn);
        this.comptimeSignatures.set(sym, comptime);
        return comptime;
    }
    strToAST(str) {
        const file = ts.createSourceFile("", str, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
        const uniquelize = (node) => {
            if (ts.isNumericLiteral(node))
                return ts.factory.createNumericLiteral(node.text);
            else if (ts.isStringLiteral(node))
                return ts.factory.createStringLiteral(node.text);
            else if (ts.isRegularExpressionLiteral(node))
                return ts.factory.createRegularExpressionLiteral(node.text);
            else if (ts.isIdentifier(node))
                return ts.factory.createIdentifier(node.text);
            else
                return ts.visitEachChild(node, uniquelize, this.context);
        };
        return ts.visitEachChild(file, uniquelize, this.context).statements;
    }
}
exports.MacroTransformer = MacroTransformer;
const separators = {
    "[]": (_transformer, body) => ts.factory.createArrayLiteralExpression(body.map(m => ts.isExpressionStatement(m) ? m.expression : m)),
    "+": (transformer, body) => (0, utils_1.toBinaryExp)(transformer, body, ts.SyntaxKind.PlusToken),
    "-": (transformer, body) => (0, utils_1.toBinaryExp)(transformer, body, ts.SyntaxKind.MinusToken),
    "*": (transformer, body) => (0, utils_1.toBinaryExp)(transformer, body, ts.SyntaxKind.AsteriskToken),
    "||": (transformer, body) => (0, utils_1.toBinaryExp)(transformer, body, ts.SyntaxKind.BarBarToken),
    "&&": (transformer, body) => (0, utils_1.toBinaryExp)(transformer, body, ts.SyntaxKind.AmpersandAmpersandToken),
    "()": (transformer, body) => ts.factory.createParenthesizedExpression((0, utils_1.toBinaryExp)(transformer, body, ts.SyntaxKind.CommaToken)),
    ".": (_, body) => {
        let last = body[0];
        for (let i = 1; i < body.length; i++) {
            const el = body[i];
            if (ts.isIdentifier(el))
                last = ts.factory.createPropertyAccessExpression(last, el);
            else
                last = ts.factory.createElementAccessExpression(last, el);
        }
        return last;
    },
    "{}": (transformer, body) => {
        return ts.factory.createObjectLiteralExpression(body.filter(el => ts.isArrayLiteralExpression(el)).map((el) => {
            const arr = el;
            if (arr.elements.length < 2)
                return ts.factory.createPropertyAssignment("undefined", ts.factory.createIdentifier("undefined"));
            const string = transformer.getStringFromNode(arr.elements[0], false, true);
            if (!string)
                return ts.factory.createPropertyAssignment("undefined", ts.factory.createIdentifier("undefined"));
            return ts.factory.createPropertyAssignment(string, arr.elements[1]);
        }));
    }
};
