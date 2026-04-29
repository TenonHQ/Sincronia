/**
 * POST /api/sinc/sincronia/getManifest/{scope}
 * Returns full manifest of records and optionally file contents for a scope.
 * Path param: scope (application scope name)
 * Body: { includes, excludes, tableOptions, withFiles, getContents }
 *
 * Web Service Definition: afaa2facc30cc710d4ddf1db050131b0 (Sincronia, global)
 * Operation sys_id: 78ca23ecc30cc710d4ddf1db050131c6
 */
(function process(/*RESTAPIRequest*/ request, /*RESTAPIResponse*/ response) {
  var utils = new SincUtils();
  var data = request.body.data;
  var includes = data.includes;
  var excludes = data.excludes;
  var tableOptions = data.tableOptions || {};
  var getContents = data.getContents || data.withFiles || false;
  var scopeName = request.pathParams.scope;

  var result = utils.getManifest({
    scopeName: scopeName,
    includes: includes,
    excludes: excludes,
    tableOptions: tableOptions,
    getContents: getContents
  });

  response.setBody(result);
})(request, response);
