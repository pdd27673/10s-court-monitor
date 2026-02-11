/**
 * Test script to check if your server IP is blocked
 * 
 * Run: npx tsx scripts/test-ip-block.ts
 */

const TEST_URLS = [
  "https://tennistowerhamlets.com/book/courts/wapping-gardens/2026-02-17",
  "https://tennistowerhamlets.com/book/courts/victoria-park/2026-02-17",
  "https://stratford.newhamparkstennis.org.uk/v0/VenueBooking/stratford_newhamparkstennis_org_uk/GetVenueSessions?resourceID=&startDate=2026-02-17&endDate=2026-02-17&roleId=",
];

async function testURL(url: string) {
  console.log(`\nTesting: ${url}`);
  console.log("-".repeat(80));

  try {
    const startTime = Date.now();
    
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
      },
    });

    const duration = Date.now() - startTime;
    const contentLength = response.headers.get("content-length") || "unknown";

    console.log(`✅ Status: ${response.status} ${response.statusText}`);
    console.log(`   Duration: ${duration}ms`);
    console.log(`   Content-Length: ${contentLength} bytes`);
    console.log(`   Content-Type: ${response.headers.get("content-type")}`);

    if (response.status === 200) {
      const text = await response.text();
      console.log(`   Body preview: ${text.substring(0, 100)}...`);
    }

    return response.status === 200;
  } catch (error) {
    console.log(`❌ Error: ${error instanceof Error ? String(error) : String(error)}`);
    return false;
  }
}

async function main() {
  console.log("=".repeat(80));
  console.log("IP BLOCK TEST");
  console.log("=".repeat(80));
  console.log("\nThis script tests if your server IP can access the tennis websites.");
  console.log("If all tests FAIL but the URLs work in your browser, you're likely blocked.\n");

  const results = await Promise.all(TEST_URLS.map(testURL));
  const successCount = results.filter(Boolean).length;

  console.log("\n" + "=".repeat(80));
  console.log("RESULTS");
  console.log("=".repeat(80));
  console.log(`Successful: ${successCount}/${TEST_URLS.length}`);

  if (successCount === 0) {
    console.log("\n❌ ALL TESTS FAILED!");
    console.log("   Your IP is likely blocked or there's a network issue.");
    console.log("   Check docs/IP-BLACKLIST-SOLUTIONS.md for solutions.");
  } else if (successCount < TEST_URLS.length) {
    console.log("\n⚠️  PARTIAL SUCCESS");
    console.log("   Some URLs are accessible, others are not.");
    console.log("   This might indicate selective blocking or temporary issues.");
  } else {
    console.log("\n✅ ALL TESTS PASSED!");
    console.log("   Your IP can access the tennis websites.");
    console.log("   The 404 errors might be due to:");
    console.log("   - Next.js fetch caching (now fixed with ky)");
    console.log("   - Temporary server issues");
    console.log("   - Rate limiting (now implemented)");
  }
}

main().catch(console.error);
