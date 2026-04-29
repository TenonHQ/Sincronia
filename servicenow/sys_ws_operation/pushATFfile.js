/**
 * POST /api/sinc/sincronia/pushATFfile
 * Updates an ATF step record's inputs.script field.
 * Body: { file, sys_id }
 *
 * Web Service Definition: afaa2facc30cc710d4ddf1db050131b0 (Sincronia, global)
 * Operation sys_id: deca2fe8334887107b18bc534d5c7be3
 */
(function process(/*RESTAPIRequest*/ request, /*RESTAPIResponse*/ response) {
  var file = request.body.data.file;
  var sys_id = request.body.data.sys_id;

  if (new SincUtils().pushATFfile(sys_id, file)) {
    response.setBody("success");
  } else {
    response.setError(new sn_ws_err.BadRequestError("Error updating ATF record"));
  }
})(request, response);
