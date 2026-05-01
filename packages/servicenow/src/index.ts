/**
 * @tenonhq/sincronia-servicenow
 *
 * ServiceNow helpers that route writes through the Sincronia "Claude" Scripted
 * REST API so every change lands in the target update set and scope.
 */

export { createClient } from "./client";
export type { ServiceNowClient, TableSchema, TableSchemaField } from "./client";

export { addChoicesToField } from "./choices";

export { formatAddChoicesResult } from "./formatter";

export { sincPlugin } from "./plugin";

export {
  listTemplates,
  verifyArtifact,
  cloneSubflow,
  cloneActionType,
  generateSysId,
  topoSort,
  executeWritePlan,
  WriteOrderError
} from "./flowDesigner";

export type {
  TemplateRef,
  ListTemplatesParams,
  FlowKind,
  VerifyExpect,
  VerifyFound,
  VerifyFailure,
  VerifyReport,
  VerifyArtifactParams,
  CloneSubflowParams,
  CloneSubflowResult,
  CloneActionTypeParams,
  CloneActionTypeResult,
  WriteOp,
  WriteOpResult
} from "./flowDesigner";

export type {
  ServiceNowClientConfig,
  ChoiceValue,
  ChoiceType,
  AddChoicesParams,
  AddChoicesResult,
  ChoiceActionResult,
  DictionaryRecord,
  UpdateSetRecord
} from "./types";
