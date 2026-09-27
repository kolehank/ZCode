import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeProviderConfigRuntime } from "../packages/provider-node/src/provider-config-runtime.js";
import { ProviderRegistryService } from "../packages/provider/src/registry-service.ts";
import { EmptyAccountProviderConfigSource } from "../packages/services/src/model-provider/providerRuntime.ts";

const diagInput = "C:/Users/Administrator/.zcode/diag-personal.json";
const staging = mkdtempSync(join(tmpdir(), "byok-diag-"));
const builtinActive = join(staging, "zcode-builtin-active.json");
copyFileSync("config/provider/byok-builtin.json", builtinActive);
const personalPath = join(staging, "provider_config.json");
copyFileSync(diagInput, personalPath);

const runtime = new NodeProviderConfigRuntime({
  zcodeBuiltinFilePath: builtinActive,
  zcodeBuiltinActiveFilePath: builtinActive,
  personalFilePath: personalPath,
});
await runtime.start();
const configSnapshot = await runtime.configService.read();
console.log("builtin providers:", configSnapshot.zcodeBuiltinProviders?.size);
console.log("personal providers:", configSnapshot.personalProviders?.size, [...(configSnapshot.personalProviders?.keys?.() ?? [])]);
console.log("personal model rules:", configSnapshot.personalModels?.rules?.length);

const registry = new ProviderRegistryService({ configSource: runtime.configService, accountSource: new EmptyAccountProviderConfigSource(runtime.configService) });
await registry.start();
const reg = registry.getSnapshot();
const resolution = reg?.resolution;
console.log("REGISTRY providerCount:", resolution?.registryProviders?.length ?? "?");
for (const p of resolution?.resolvedProviders ?? []) {
  console.log(`- ${p.providerId} enabled=${p.enabled} executable=${p.executable}`);
  if (p.providerIssues?.length) console.log(`    provider issues: ${JSON.stringify(p.providerIssues)}`);
  for (const m of p.models ?? []) {
    if (m.issues?.length) console.log(`    model ${m.modelId} ISSUES: ${JSON.stringify(m.issues)}`);
    else console.log(`    model ${m.modelId} executable=${m.executable} selectable=${m.selectable}`);
  }
}
await registry.dispose?.();
await runtime.dispose?.();
rmSync(diagInput, { force: true });
