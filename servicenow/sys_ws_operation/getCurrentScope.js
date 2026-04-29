/**
 * GET /api/sinc/sincronia/getCurrentScope
 * Returns current user's active application scope.
 *
 * Web Service Definition: afaa2facc30cc710d4ddf1db050131b0 (Sincronia, global)
 * Operation sys_id: 98ca23ecc30cc710d4ddf1db05013120
 */
(function process(/*RESTAPIRequest*/ request, /*RESTAPIResponse*/ response) {
  var utils = new SincUtils();
  response.setBody(utils.getCurrentScope());
})(request, response);
