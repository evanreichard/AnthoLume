import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../web/package.json', import.meta.url));
const { default: openapiTS, astToString } = require('openapi-typescript');
const ts = require('typescript');
const ast = await openapiTS(new URL('./openapi.yaml', import.meta.url), {
  transform(node) {
    if (node.type === 'string' && node.format === 'binary') return ts.factory.createTypeReferenceNode('Blob');
  },
});
await fs.writeFile(process.argv[2] ?? new URL('../web/src/api/schema.gen.ts', import.meta.url), astToString(ast));
