import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const require = createRequire(new URL('../web/package.json', import.meta.url));
const { validator } = require('@exodus/schemasafe');
const { load } = require('js-yaml');
const spec = load(await readFile(new URL('./openapi.yaml', import.meta.url), 'utf8'));
const components = new Map();
const guards = new Map();

// OpenAPI 3.0 - Translate nullable and Go-only annotations before compiling as JSON Schema.
function jsonSchema(input) {
  if (input.$ref) {
    const name = input.$ref.split('/').pop();
    if (!components.has(name)) {
      components.set(name, null);
      components.set(name, jsonSchema(spec.components.schemas[name]));
    }
    return { $ref: `urn:antholume:${name}` };
  }
  const { nullable, properties, items, format, 'x-go-type': goType, description, ...schema } = input;
  if (properties) schema.properties = Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, jsonSchema(value)]));
  if (items) schema.items = jsonSchema(items);
  if (schema.type === 'integer') {
    schema.minimum = Math.max(schema.minimum ?? -Infinity, Number.MIN_SAFE_INTEGER);
    schema.maximum = Math.min(schema.maximum ?? Infinity, Number.MAX_SAFE_INTEGER);
  }
  if (format && !['double', 'int64'].includes(format)) schema.format = format;
  if (nullable) schema.type = [schema.type, 'null'];
  return schema;
}

for (const path of Object.values(spec.paths)) for (const op of Object.values(path)) {
  if (!op.operationId) continue;
  for (const [status, response] of Object.entries(op.responses)) {
    const schema = response.content?.['application/json']?.schema;
    if (!schema) continue;
    const shape = jsonSchema(schema);
    if (!schema.$ref) guards.set(`${op.operationId[0].toUpperCase()}${op.operationId.slice(1)}${status}`, {
      shape, type: `operations['${op.operationId}']['responses'][${status}]['content']['application/json']`,
    });
  }
}
jsonSchema({ $ref: '#/components/schemas/Problem' });
for (const name of components.keys()) guards.set(name, {
  shape: { $ref: `urn:antholume:${name}` }, type: `components['schemas']['${name}']`,
});
const check = validator([...guards.values()].map(g => g.shape), {
  multi: true,
  schemas: Object.fromEntries([...components].map(([name, schema]) => [`urn:antholume:${name}`, schema])),
  formats: {
    'date-time': value => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19),
  },
});
const prefix = '// Generated from api/openapi.yaml; do not edit.\n';
const dir = process.argv[2];
await writeFile(join(dir, 'guards.gen.js'), `${prefix}export const [${[...guards.keys()].map(k => `check${k}`).join(', ')}] = ${check.toModule()}\n`);
await writeFile(join(dir, 'guards.gen.d.ts'), prefix + "import type { components, operations } from './schema.gen';\n" + [...guards].map(([k, g]) => `export declare function check${k}(value: unknown): value is ${g.type};\n`).join(''));
