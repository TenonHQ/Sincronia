/**
 * GET /api/sinc/sincronia/getAppList
 * Returns list of all application scopes.
 *
 * Web Service Definition: afaa2facc30cc710d4ddf1db050131b0 (Sincronia, global)
 * Operation sys_id: 6bbaefacc30cc710d4ddf1db050131ac
 */
(function process(/*RESTAPIRequest*/ request, /*RESTAPIResponse*/ response) {
  var utils = new SincUtils();
  response.setBody(utils.getAppList());
})(request, response);
