/**
 * POST /api/sinc/sincronia/bulkDownload
 * Downloads file contents for specific missing records.
 * Body: { missingFiles, tableOptions }
 *
 * Web Service Definition: afaa2facc30cc710d4ddf1db050131b0 (Sincronia, global)
 * Operation sys_id: e5ca236c334887107b18bc534d5c7b75
 */
(function process(/*RESTAPIRequest*/ request, /*RESTAPIResponse*/ response) {
  var utils = new SincUtils();
  var data = request.body.data;
  var missingFiles = data.missingFiles;
  var tableOptions = data.tableOptions;

  var result = utils.processMissingFiles(missingFiles, tableOptions);
  response.setBody(result);
})(request, response);
