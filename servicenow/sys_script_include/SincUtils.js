/**
 * SincUtils — entry-point class used by the Sincronia REST API operations.
 * Extends SincUtilsMS so individual operation scripts can `new SincUtils()` and
 * call helpers like getManifest, processMissingFiles, getAppList, etc.
 *
 * Deploy to: Global Scope > Script Includes
 * Name: SincUtils
 * api_name: global.SincUtils
 * sys_id: b9aa2facc30cc710d4ddf1db0501317a
 * Accessible from: All application scopes
 */
var SincUtils = Class.create();
SincUtils.prototype = Object.extendsObject(SincUtilsMS, {
  initialize: function () {
    SincUtilsMS.prototype.initialize.call(this);
    this.type = "SincUtils";
  },

  type: "SincUtils"
});
