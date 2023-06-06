"use strict";
/* eslint-disable @typescript-eslint/no-explicit-any */
Object.defineProperty(exports, "__esModule", { value: true });
exports.macros = void 0;
const transformer_1 = require("./transformer");
exports.macros = new Map();
exports.default = (program, config) => ctx => {
    const typeChecker = program.getTypeChecker();
    const transformer = new transformer_1.MacroTransformer(ctx, typeChecker, exports.macros, config);
    return firstNode => {
        return transformer.run(firstNode);
    };
};
