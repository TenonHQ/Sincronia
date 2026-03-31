import axios, { AxiosInstance } from "axios";
import chalk from "chalk";
import { SchemaOptions, RawSchemaMap, TableField } from "./types";

function createClient(options: { instance: string; username: string; password: string }): AxiosInstance {
  const baseURL = options.instance.startsWith("https://")
    ? options.instance
    : `https://${options.instance}`;

  return axios.create({
    baseURL: baseURL.endsWith("/") ? baseURL : baseURL + "/",
    auth: {
      username: options.username,
      password: options.password,
    },
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
  });
}

async function getTablesForScope(options: {
  client: AxiosInstance;
  scope: string;
}): Promise<Array<{ name: string; label: string; super_class: any }>> {
  const { client, scope } = options;
  const response = await client.get("api/now/table/sys_db_object", {
    params: {
      sysparm_query: `nameSTARTSWITH${scope}_`,
      sysparm_fields: "name,label,super_class",
    },
  });

  return response.data.result || [];
}

async function getTableHierarchy(options: {
  client: AxiosInstance;
  tableName: string;
  visited?: Set<string>;
}): Promise<string[]> {
  const { client, tableName } = options;
  const visited = options.visited || new Set<string>();

  if (visited.has(tableName)) {
    return [];
  }

  visited.add(tableName);

  try {
    const response = await client.get("api/now/table/sys_db_object", {
      params: {
        sysparm_query: `name=${tableName}`,
        sysparm_fields: "name,super_class,label",
      },
    });

    if (response.data.result && response.data.result.length > 0) {
      const table = response.data.result[0];
      const hierarchy = [tableName];

      if (table.super_class && table.super_class.value) {
        const parentResponse = await client.get(
          `api/now/table/sys_db_object/${table.super_class.value}`,
          {
            params: { sysparm_fields: "name" },
          }
        );

        if (parentResponse.data.result && parentResponse.data.result.name) {
          const parentHierarchy = await getTableHierarchy({
            client,
            tableName: parentResponse.data.result.name,
            visited,
          });
          hierarchy.push(...parentHierarchy);
        }
      }

      return hierarchy;
    }
  } catch (error: any) {
    console.error(chalk.yellow(`  Warning: Error getting hierarchy for ${tableName}: ${error.message}`));
  }

  return [tableName];
}

async function getTableFields(options: {
  client: AxiosInstance;
  tableName: string;
}): Promise<TableField[]> {
  const { client, tableName } = options;

  try {
    const query = `internal_type!=collection^ORinternal_type=NULL^name=${tableName}`;
    const response = await client.get("api/now/table/sys_dictionary", {
      params: {
        sysparm_query: query,
        sysparm_fields: "element,column_label,internal_type,max_length,mandatory,reference,default_value",
      },
    });

    if (response.data.result) {
      return response.data.result.map((field: any) => ({
        name: field.element,
        label: field.column_label,
        type: field.internal_type && field.internal_type.value
          ? field.internal_type.value
          : field.internal_type || "",
        max_length: field.max_length || "",
        mandatory: field.mandatory === "true",
        reference: field.reference || "",
        default_value: field.default_value || "",
        inherited_from: null,
      }));
    }
  } catch (error: any) {
    console.error(chalk.yellow(`  Warning: Error getting fields for ${tableName}: ${error.message}`));
  }

  return [];
}

export async function fetchSchema(options: SchemaOptions): Promise<RawSchemaMap> {
  const { scopes } = options;
  const client = createClient({
    instance: options.instance,
    username: options.username,
    password: options.password,
  });

  console.log(chalk.blue(`Fetching table schemas for ${scopes.length} scopes...\n`));

  const schema: RawSchemaMap = {};

  for (const scope of scopes) {
    console.log(chalk.blue(`\nScope: ${scope}`));

    const tables = await getTablesForScope({ client, scope });

    if (tables.length === 0) {
      console.log(chalk.yellow(`  No tables found for scope ${scope}`));
      continue;
    }

    console.log(chalk.green(`  Found ${tables.length} tables`));

    for (const table of tables) {
      console.log(`  Processing: ${chalk.cyan(table.name)} (${table.label})`);

      const hierarchy = await getTableHierarchy({ client, tableName: table.name });
      console.log(chalk.gray(`    Hierarchy: ${hierarchy.join(" -> ")}`));

      const allFields = new Map<string, TableField>();

      for (let i = hierarchy.length - 1; i >= 0; i--) {
        const hierarchyTableName = hierarchy[i];
        const fields = await getTableFields({ client, tableName: hierarchyTableName });

        for (const field of fields) {
          allFields.set(field.name, {
            ...field,
            inherited_from: i > 0 ? hierarchyTableName : null,
          });
        }
      }

      schema[table.name] = {
        label: table.label,
        scope,
        parent: hierarchy.length > 1 ? hierarchy[1] : null,
        hierarchy,
        fields: Array.from(allFields.values()),
      };

      console.log(chalk.gray(`    ${allFields.size} fields (including inherited)`));
    }
  }

  console.log(chalk.green(`\nFetched schema for ${Object.keys(schema).length} tables across ${scopes.length} scopes`));
  return schema;
}
