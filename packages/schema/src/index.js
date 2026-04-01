var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
(function (factory) {
    if (typeof module === "object" && typeof module.exports === "object") {
        var v = factory(require, exports);
        if (v !== undefined) module.exports = v;
    }
    else if (typeof define === "function" && define.amd) {
        define(["require", "exports", "./fetcher", "./organizer", "./fetcher", "./organizer", "./types"], factory);
    }
})(function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.groupByApplication = exports.organizeSchema = exports.fetchSchema = void 0;
    exports.pullSchema = pullSchema;
    const fetcher_1 = require("./fetcher");
    const organizer_1 = require("./organizer");
    var fetcher_2 = require("./fetcher");
    Object.defineProperty(exports, "fetchSchema", { enumerable: true, get: function () { return fetcher_2.fetchSchema; } });
    var organizer_2 = require("./organizer");
    Object.defineProperty(exports, "organizeSchema", { enumerable: true, get: function () { return organizer_2.organizeSchema; } });
    Object.defineProperty(exports, "groupByApplication", { enumerable: true, get: function () { return organizer_2.groupByApplication; } });
    __exportStar(require("./types"), exports);
    async function pullSchema(options) {
        const schema = await (0, fetcher_1.fetchSchema)(options);
        const instanceName = options.instance.replace(/^https?:\/\//, "").replace(/\/$/, "");
        const index = await (0, organizer_1.organizeSchema)({
            schema,
            outputDir: options.outputDir,
            instance: instanceName,
            scopes: options.scopes,
        });
        return index;
    }
});
