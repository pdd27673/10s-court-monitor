/**
 * Test script to verify proxy is working
 *
 * Run: npx tsx scripts/test-proxy.ts
 */

import "dotenv/config";
import { proxyManager } from "../src/lib/proxy-manager";

async function main() {
  console.log("=".repeat(60));
  console.log("PROXY TEST");
  console.log("=".repeat(60));

  const result = await proxyManager.testConnection();

  console.log("\n" + "=".repeat(60));
  console.log("RESULT");
  console.log("=".repeat(60));
  console.log(JSON.stringify(result, null, 2));

  if (result.success) {
    console.log("\n✅ Proxy is working correctly!");
    console.log(`   Your direct IP: ${result.direct}`);
    console.log(`   Proxy IP: ${result.ip}`);
  } else {
    console.log("\n❌ Proxy is NOT working!");
    console.log(`   Error: ${result.error}`);
    if (result.direct) {
      console.log(`   Your direct IP: ${result.direct}`);
    }
  }
}

main().catch(console.error);
