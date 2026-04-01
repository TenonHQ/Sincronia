var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
(function (factory) {
    if (typeof module === "object" && typeof module.exports === "object") {
        var v = factory(require, exports);
        if (v !== undefined) module.exports = v;
    }
    else if (typeof define === "function" && define.amd) {
        define(["require", "exports", "axios"], factory);
    }
})(function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createClient = createClient;
    exports.getAuthorizedUser = getAuthorizedUser;
    exports.getTask = getTask;
    exports.listMyTasks = listMyTasks;
    exports.createTask = createTask;
    exports.updateTask = updateTask;
    exports.updateTaskStatus = updateTaskStatus;
    exports.deleteTask = deleteTask;
    exports.addComment = addComment;
    exports.getTeams = getTeams;
    exports.getSpaces = getSpaces;
    exports.getFolders = getFolders;
    exports.getLists = getLists;
    exports.getSpaceLists = getSpaceLists;
    exports.getListTasks = getListTasks;
    exports.listTeamTasks = listTeamTasks;
    exports.createClickUpApi = createClickUpApi;
    const axios_1 = __importDefault(require("axios"));
    var CLICKUP_BASE_URL = "https://api.clickup.com";
    /**
     * @description Creates a configured axios instance for the ClickUp API v2.
     * @param config - Client configuration with token and optional base URL.
     * @returns Configured axios instance.
     */
    function createClient(config) {
        var baseURL = config.baseUrl || CLICKUP_BASE_URL;
        return axios_1.default.create({
            baseURL: baseURL,
            headers: {
                "Authorization": config.token,
                "Content-Type": "application/json",
            },
        });
    }
    // --- Error Handling ---
    function handleApiError(error, context) {
        if (axios_1.default.isAxiosError(error)) {
            var response = error.response;
            if (response) {
                if (response.status === 401) {
                    throw new Error("ClickUp authentication failed. Check your CLICKUP_API_TOKEN. " +
                        "Run 'sinc clickup setup' or verify your .env file.");
                }
                if (response.status === 404) {
                    throw new Error("ClickUp " + context + " not found. Verify the ID.");
                }
                if (response.status === 429) {
                    throw new Error("ClickUp API rate limit exceeded. Wait a moment and try again.");
                }
                var message = response.data && typeof response.data === "object" && "err" in response.data
                    ? String(response.data.err)
                    : "HTTP " + response.status;
                throw new Error("ClickUp API error (" + context + "): " + message);
            }
        }
        throw error;
    }
    // --- User ---
    /**
     * @description Gets the authenticated user from the API token.
     * @param params - Object with the axios client.
     * @returns The authenticated ClickUp user.
     */
    async function getAuthorizedUser(params) {
        try {
            var response = await params.client.get("/api/v2/user");
            return response.data.user;
        }
        catch (error) {
            return handleApiError(error, "user");
        }
    }
    // --- Tasks ---
    /**
     * @description Fetches a single ClickUp task by ID.
     * @param params - Object with client and taskId.
     * @returns The ClickUp task.
     */
    async function getTask(params) {
        try {
            var response = await params.client.get("/api/v2/task/" + params.taskId);
            return response.data;
        }
        catch (error) {
            return handleApiError(error, "task '" + params.taskId + "'");
        }
    }
    /**
     * @description Lists tasks assigned to the authenticated user, grouped by status.
     * @param params - Object with client, teamId, and optional status filters.
     * @returns Tasks grouped by status with totals.
     */
    async function listMyTasks(params) {
        try {
            // Get the authenticated user's ID
            var user = await getAuthorizedUser({ client: params.client });
            var queryParams = {
                "assignees[]": user.id,
                "include_closed": false,
                "subtasks": true,
                "order_by": "updated",
                "reverse": true,
            };
            // Add status filters if provided
            if (params.statuses && params.statuses.length > 0) {
                queryParams["statuses[]"] = params.statuses;
            }
            var response = await params.client.get("/api/v2/team/" + params.teamId + "/task", { params: queryParams });
            var tasks = response.data.tasks || [];
            // Group by status
            var byStatus = {};
            for (var i = 0; i < tasks.length; i++) {
                var task = tasks[i];
                var statusName = task.status && task.status.status ? task.status.status : "unknown";
                if (!byStatus[statusName]) {
                    byStatus[statusName] = [];
                }
                byStatus[statusName].push(task);
            }
            return {
                tasks: tasks,
                byStatus: byStatus,
                total: tasks.length,
            };
        }
        catch (error) {
            return handleApiError(error, "tasks for team '" + params.teamId + "'");
        }
    }
    /**
     * @description Creates a new task in a ClickUp list.
     * @param params - Object with client, listId, name, and optional fields.
     * @returns The created task.
     */
    async function createTask(params) {
        try {
            var body = {
                name: params.name,
            };
            if (params.description !== undefined) {
                body.description = params.description;
            }
            if (params.assignees !== undefined) {
                body.assignees = params.assignees;
            }
            if (params.status !== undefined) {
                body.status = params.status;
            }
            if (params.priority !== undefined) {
                body.priority = params.priority;
            }
            var response = await params.client.post("/api/v2/list/" + params.listId + "/task", body);
            return response.data;
        }
        catch (error) {
            return handleApiError(error, "creating task in list '" + params.listId + "'");
        }
    }
    /**
     * @description Updates an existing ClickUp task.
     * @param params - Object with client, taskId, and fields to update.
     * @returns The updated task.
     */
    async function updateTask(params) {
        try {
            var body = {};
            if (params.name !== undefined) {
                body.name = params.name;
            }
            if (params.description !== undefined) {
                body.description = params.description;
            }
            if (params.status !== undefined) {
                body.status = params.status;
            }
            if (params.assignees !== undefined) {
                body.assignees = params.assignees;
            }
            if (params.priority !== undefined) {
                body.priority = params.priority;
            }
            var response = await params.client.put("/api/v2/task/" + params.taskId, body);
            return response.data;
        }
        catch (error) {
            return handleApiError(error, "updating task '" + params.taskId + "'");
        }
    }
    /**
     * @description Convenience function to update only a task's status.
     * @param params - Object with client, taskId, and new status.
     * @returns The updated task.
     */
    async function updateTaskStatus(params) {
        return updateTask({
            client: params.client,
            taskId: params.taskId,
            status: params.status,
        });
    }
    /**
     * @description Deletes a ClickUp task.
     * @param params - Object with client and taskId.
     */
    async function deleteTask(params) {
        try {
            await params.client.delete("/api/v2/task/" + params.taskId);
        }
        catch (error) {
            return handleApiError(error, "deleting task '" + params.taskId + "'");
        }
    }
    // --- Comments ---
    /**
     * @description Adds a comment to a ClickUp task.
     * @param params - Object with client, taskId, and comment text.
     * @returns The created comment.
     */
    async function addComment(params) {
        try {
            var response = await params.client.post("/api/v2/task/" + params.taskId + "/comment", { comment_text: params.commentText });
            return response.data;
        }
        catch (error) {
            return handleApiError(error, "adding comment to task '" + params.taskId + "'");
        }
    }
    // --- Workspace / Hierarchy ---
    /**
     * @description Lists all teams (workspaces) accessible to the authenticated user.
     * @param params - Object with the axios client.
     * @returns Array of ClickUp teams.
     */
    async function getTeams(params) {
        try {
            var response = await params.client.get("/api/v2/team");
            return response.data.teams || [];
        }
        catch (error) {
            return handleApiError(error, "teams");
        }
    }
    /**
     * @description Lists all spaces in a team/workspace.
     * @param params - Object with client and teamId.
     * @returns Array of ClickUp spaces.
     */
    async function getSpaces(params) {
        try {
            var response = await params.client.get("/api/v2/team/" + params.teamId + "/space");
            return response.data.spaces || [];
        }
        catch (error) {
            return handleApiError(error, "spaces for team '" + params.teamId + "'");
        }
    }
    /**
     * @description Lists all folders in a space.
     * @param params - Object with client and spaceId.
     * @returns Array of ClickUp folders.
     */
    async function getFolders(params) {
        try {
            var response = await params.client.get("/api/v2/space/" + params.spaceId + "/folder");
            return response.data.folders || [];
        }
        catch (error) {
            return handleApiError(error, "folders for space '" + params.spaceId + "'");
        }
    }
    /**
     * @description Lists all lists in a folder.
     * @param params - Object with client and folderId.
     * @returns Array of ClickUp lists.
     */
    async function getLists(params) {
        try {
            var response = await params.client.get("/api/v2/folder/" + params.folderId + "/list");
            return response.data.lists || [];
        }
        catch (error) {
            return handleApiError(error, "lists for folder '" + params.folderId + "'");
        }
    }
    // --- Space Lists (folderless) ---
    /**
     * @description Lists all folderless lists in a space.
     * @param params - Object with client and spaceId.
     * @returns Array of ClickUp lists.
     */
    async function getSpaceLists(params) {
        try {
            var response = await params.client.get("/api/v2/space/" + params.spaceId + "/list");
            return response.data.lists || [];
        }
        catch (error) {
            return handleApiError(error, "lists for space '" + params.spaceId + "'");
        }
    }
    // --- List Tasks ---
    /**
     * @description Fetches tasks from a specific list with pagination support.
     * @param params - Object with client, listId, optional page number and includeClosed flag.
     * @returns Array of ClickUp tasks for that page.
     */
    async function getListTasks(params) {
        try {
            var queryParams = {
                "subtasks": true,
                "page": params.page !== undefined ? params.page : 0,
                "include_closed": params.includeClosed === true,
            };
            var response = await params.client.get("/api/v2/list/" + params.listId + "/task", { params: queryParams });
            return response.data.tasks || [];
        }
        catch (error) {
            return handleApiError(error, "tasks for list '" + params.listId + "'");
        }
    }
    /**
     * @description Fetches all tasks from a list, handling pagination automatically.
     * @param params - Object with client, listId, and optional includeClosed flag.
     * @returns All tasks from the list.
     */
    async function getAllListTasks(params) {
        var allTasks = [];
        var page = 0;
        while (true) {
            var tasks = await getListTasks({
                client: params.client,
                listId: params.listId,
                page: page,
                includeClosed: params.includeClosed,
            });
            allTasks = allTasks.concat(tasks);
            if (tasks.length < 100) {
                break;
            }
            page = page + 1;
        }
        return allTasks;
    }
    // --- Team Tasks ---
    /**
     * @description Fetches all tasks across configured spaces, grouped by status and assignee.
     * @param params - Object with client, teamId, optional spaceIds, statuses, and includeClosed.
     * @returns Tasks grouped by status and assignee with totals.
     */
    async function listTeamTasks(params) {
        try {
            // Resolve spaces — use provided spaceIds or fetch all from team
            var spaces = [];
            if (params.spaceIds && params.spaceIds.length > 0) {
                spaces = params.spaceIds;
            }
            else {
                var teamSpaces = await getSpaces({ client: params.client, teamId: params.teamId });
                for (var si = 0; si < teamSpaces.length; si++) {
                    spaces.push(teamSpaces[si].id);
                }
            }
            // Collect all list IDs from all spaces
            var listIds = [];
            for (var s = 0; s < spaces.length; s++) {
                var spaceId = spaces[s];
                // Folderless lists
                var spaceLists = await getSpaceLists({ client: params.client, spaceId: spaceId });
                for (var sl = 0; sl < spaceLists.length; sl++) {
                    listIds.push(spaceLists[sl].id);
                }
                // Folder lists
                var folders = await getFolders({ client: params.client, spaceId: spaceId });
                for (var f = 0; f < folders.length; f++) {
                    var folderLists = folders[f].lists || [];
                    for (var fl = 0; fl < folderLists.length; fl++) {
                        listIds.push(folderLists[fl].id);
                    }
                }
            }
            // Fetch tasks from all lists
            var allTasks = [];
            var seen = {};
            for (var l = 0; l < listIds.length; l++) {
                var tasks = await getAllListTasks({
                    client: params.client,
                    listId: listIds[l],
                    includeClosed: params.includeClosed,
                });
                for (var t = 0; t < tasks.length; t++) {
                    var task = tasks[t];
                    if (!seen[task.id]) {
                        seen[task.id] = true;
                        // Apply status filter if provided
                        if (params.statuses && params.statuses.length > 0) {
                            var taskStatus = task.status && task.status.status
                                ? task.status.status.toLowerCase()
                                : "";
                            var matched = false;
                            for (var st = 0; st < params.statuses.length; st++) {
                                if (taskStatus === params.statuses[st].toLowerCase()) {
                                    matched = true;
                                    break;
                                }
                            }
                            if (!matched) {
                                continue;
                            }
                        }
                        allTasks.push(task);
                    }
                }
            }
            // Group by status
            var byStatus = {};
            for (var bs = 0; bs < allTasks.length; bs++) {
                var bsTask = allTasks[bs];
                var statusName = bsTask.status && bsTask.status.status
                    ? bsTask.status.status
                    : "unknown";
                if (!byStatus[statusName]) {
                    byStatus[statusName] = [];
                }
                byStatus[statusName].push(bsTask);
            }
            // Group by assignee
            var byAssignee = {};
            var unassigned = [];
            for (var ba = 0; ba < allTasks.length; ba++) {
                var baTask = allTasks[ba];
                if (!baTask.assignees || baTask.assignees.length === 0) {
                    unassigned.push(baTask);
                }
                else {
                    for (var a = 0; a < baTask.assignees.length; a++) {
                        var assigneeName = baTask.assignees[a].username
                            || baTask.assignees[a].email
                            || String(baTask.assignees[a].id);
                        if (!byAssignee[assigneeName]) {
                            byAssignee[assigneeName] = [];
                        }
                        byAssignee[assigneeName].push(baTask);
                    }
                }
            }
            return {
                tasks: allTasks,
                byStatus: byStatus,
                byAssignee: byAssignee,
                unassigned: unassigned,
                total: allTasks.length,
            };
        }
        catch (error) {
            return handleApiError(error, "team tasks for team '" + params.teamId + "'");
        }
    }
    /**
     * @description Creates a ClickUp API object with all functions pre-bound to a client.
     * @param config - Client configuration with token and optional base URL.
     * @returns Object with all ClickUp API functions.
     */
    function createClickUpApi(config) {
        var client = createClient(config);
        return {
            getAuthorizedUser: function () {
                return getAuthorizedUser({ client: client });
            },
            getTask: function (params) {
                return getTask({ client: client, taskId: params.taskId });
            },
            listMyTasks: function (params) {
                return listMyTasks({
                    client: client,
                    teamId: params.teamId,
                    statuses: params.statuses,
                });
            },
            createTask: function (params) {
                return createTask({
                    client: client,
                    listId: params.listId,
                    name: params.name,
                    description: params.description,
                    assignees: params.assignees,
                    status: params.status,
                    priority: params.priority,
                });
            },
            updateTask: function (params) {
                return updateTask({
                    client: client,
                    taskId: params.taskId,
                    name: params.name,
                    description: params.description,
                    status: params.status,
                    assignees: params.assignees,
                    priority: params.priority,
                });
            },
            updateTaskStatus: function (params) {
                return updateTaskStatus({
                    client: client,
                    taskId: params.taskId,
                    status: params.status,
                });
            },
            deleteTask: function (params) {
                return deleteTask({ client: client, taskId: params.taskId });
            },
            addComment: function (params) {
                return addComment({
                    client: client,
                    taskId: params.taskId,
                    commentText: params.commentText,
                });
            },
            getTeams: function () {
                return getTeams({ client: client });
            },
            getSpaces: function (params) {
                return getSpaces({ client: client, teamId: params.teamId });
            },
            getFolders: function (params) {
                return getFolders({ client: client, spaceId: params.spaceId });
            },
            getLists: function (params) {
                return getLists({ client: client, folderId: params.folderId });
            },
            getSpaceLists: function (params) {
                return getSpaceLists({ client: client, spaceId: params.spaceId });
            },
            getListTasks: function (params) {
                return getListTasks({
                    client: client,
                    listId: params.listId,
                    page: params.page,
                    includeClosed: params.includeClosed,
                });
            },
            listTeamTasks: function (params) {
                return listTeamTasks({
                    client: client,
                    teamId: params.teamId,
                    spaceIds: params.spaceIds,
                    statuses: params.statuses,
                    includeClosed: params.includeClosed,
                });
            },
        };
    }
});
