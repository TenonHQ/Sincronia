/**
 * @tenonhq/sincronia-clickup
 *
 * ClickUp API v2 client for Sincronia.
 * Provides task management, workspace navigation, and formatting utilities.
 */
(function (factory) {
    if (typeof module === "object" && typeof module.exports === "object") {
        var v = factory(require, exports);
        if (v !== undefined) module.exports = v;
    }
    else if (typeof define === "function" && define.amd) {
        define(["require", "exports", "./client", "./formatter", "./parser"], factory);
    }
})(function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.parseClickUpIdentifier = exports.formatTeamSync = exports.formatTaskSummary = exports.formatTaskDetail = exports.formatForClaude = exports.getListTasks = exports.getSpaceLists = exports.getLists = exports.getFolders = exports.getSpaces = exports.getTeams = exports.addComment = exports.deleteTask = exports.updateTaskStatus = exports.updateTask = exports.createTask = exports.listTeamTasks = exports.listMyTasks = exports.getTask = exports.getAuthorizedUser = exports.createClickUpApi = exports.createClient = void 0;
    // Client and API functions
    var client_1 = require("./client");
    Object.defineProperty(exports, "createClient", { enumerable: true, get: function () { return client_1.createClient; } });
    Object.defineProperty(exports, "createClickUpApi", { enumerable: true, get: function () { return client_1.createClickUpApi; } });
    Object.defineProperty(exports, "getAuthorizedUser", { enumerable: true, get: function () { return client_1.getAuthorizedUser; } });
    Object.defineProperty(exports, "getTask", { enumerable: true, get: function () { return client_1.getTask; } });
    Object.defineProperty(exports, "listMyTasks", { enumerable: true, get: function () { return client_1.listMyTasks; } });
    Object.defineProperty(exports, "listTeamTasks", { enumerable: true, get: function () { return client_1.listTeamTasks; } });
    Object.defineProperty(exports, "createTask", { enumerable: true, get: function () { return client_1.createTask; } });
    Object.defineProperty(exports, "updateTask", { enumerable: true, get: function () { return client_1.updateTask; } });
    Object.defineProperty(exports, "updateTaskStatus", { enumerable: true, get: function () { return client_1.updateTaskStatus; } });
    Object.defineProperty(exports, "deleteTask", { enumerable: true, get: function () { return client_1.deleteTask; } });
    Object.defineProperty(exports, "addComment", { enumerable: true, get: function () { return client_1.addComment; } });
    Object.defineProperty(exports, "getTeams", { enumerable: true, get: function () { return client_1.getTeams; } });
    Object.defineProperty(exports, "getSpaces", { enumerable: true, get: function () { return client_1.getSpaces; } });
    Object.defineProperty(exports, "getFolders", { enumerable: true, get: function () { return client_1.getFolders; } });
    Object.defineProperty(exports, "getLists", { enumerable: true, get: function () { return client_1.getLists; } });
    Object.defineProperty(exports, "getSpaceLists", { enumerable: true, get: function () { return client_1.getSpaceLists; } });
    Object.defineProperty(exports, "getListTasks", { enumerable: true, get: function () { return client_1.getListTasks; } });
    // Formatting utilities
    var formatter_1 = require("./formatter");
    Object.defineProperty(exports, "formatForClaude", { enumerable: true, get: function () { return formatter_1.formatForClaude; } });
    Object.defineProperty(exports, "formatTaskDetail", { enumerable: true, get: function () { return formatter_1.formatTaskDetail; } });
    Object.defineProperty(exports, "formatTaskSummary", { enumerable: true, get: function () { return formatter_1.formatTaskSummary; } });
    Object.defineProperty(exports, "formatTeamSync", { enumerable: true, get: function () { return formatter_1.formatTeamSync; } });
    // URL/ID parsing
    var parser_1 = require("./parser");
    Object.defineProperty(exports, "parseClickUpIdentifier", { enumerable: true, get: function () { return parser_1.parseClickUpIdentifier; } });
});
