import { __descriptor, __getRegisteredPlugin } from "workbuddy-byok:plugin";

if (Deno.args.length !== 1) throw new Error("plugin entry URL is required");
await import(Deno.args[0]);
console.log("WORKBUDDY_BYOK_PLUGIN_DEFINITION:" + JSON.stringify(__descriptor(__getRegisteredPlugin())));
