/**
 * Sincronia init plugin for @tenonhq/sincronia-servicenow.
 * Auth piggybacks on `npx sinc configure` — SN_INSTANCE / SN_USER / SN_PASSWORD
 * already get wired there, so this plugin is currently a no-op discoverable marker.
 */

export const sincPlugin = {
  name: "servicenow",
  displayName: "ServiceNow",
  description: "Dictionary / choice helpers and update-set-aware writes",
  login: [],
  configure: []
};
