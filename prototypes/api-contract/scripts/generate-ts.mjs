import fs from "node:fs/promises";
import openapiTS, { astToString } from "openapi-typescript";
import ts from "typescript";

const schema = new URL("../openapi.yaml", import.meta.url);
const ast = await openapiTS(schema, {
  transform(node) {
    if (node.type === "string" && node.format === "binary") {
      return ts.factory.createTypeReferenceNode("Blob");
    }
  },
});
await fs.writeFile(process.argv[2] ?? new URL("../client/schema.gen.ts", import.meta.url), astToString(ast));
