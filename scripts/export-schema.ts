import { writeFileSync } from "node:fs";
import { HarnessSchema } from "@forge/harness-spec";

// harness.schema.json gives editors (YAML language server) completion and validation for harness.yaml.
writeFileSync("schema/harness.schema.json", `${JSON.stringify(HarnessSchema, null, "\t")}\n`);
console.log("wrote schema/harness.schema.json");
