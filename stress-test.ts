#!/usr/bin/env bun

interface TestResult {
  requestId: number;
  method: string;
  success: boolean;
  responseTime: number;
  error?: string;
}

// Test configuration
const PROXY_URL = process.env.PROXY_URL || "http://localhost:3000/rpc";
const TEST_DURATION = 20000; // 20 seconds
const TARGET_RPS = 50; // Target requests per second (middle of 30-70 range)
const REQUEST_INTERVAL = 1000 / TARGET_RPS; // Milliseconds between requests

// Common RPC methods to test
const TEST_METHODS = [
  {
    method: "eth_blockNumber",
    params: [],
    weight: 3 // More frequent
  },
  {
    method: "eth_getBalance",
    params: ["0x0000000000000000000000000000000000000000", "latest"],
    weight: 2
  },
  {
    method: "eth_gasPrice",
    params: [],
    weight: 2
  },
  {
    method: "eth_getTransactionCount",
    params: ["0x0000000000000000000000000000000000000000", "latest"],
    weight: 1
  },
  {
    method: "eth_chainId",
    params: [],
    weight: 1
  },
  {
    method: "net_version",
    params: [],
    weight: 1
  }
];

// Create weighted array for random selection
const weightedMethods = TEST_METHODS.flatMap(m => 
  Array(m.weight).fill({ method: m.method, params: m.params })
);

// Statistics tracking
const results: TestResult[] = [];
let requestId = 0;
let startTime: number;

// Make a single RPC request
async function makeRequest(method: string, params: any[]): Promise<TestResult> {
  const id = ++requestId;
  const start = Date.now();
  
  try {
    const response = await fetch(PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
        id
      })
    });
    
    const data = await response.json();
    const responseTime = Date.now() - start;
    
    return {
      requestId: id,
      method,
      success: !data.error,
      responseTime,
      error: data.error?.message
    };
  } catch (error) {
    const responseTime = Date.now() - start;
    return {
      requestId: id,
      method,
      success: false,
      responseTime,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

// Generate random requests
async function runStressTest() {
  console.log(`🚀 Starting stress test...`);
  console.log(`📊 Target: ${TARGET_RPS} RPS for ${TEST_DURATION / 1000} seconds`);
  console.log(`🌐 Proxy URL: ${PROXY_URL}`);
  console.log(`\n⏳ Running test...\n`);
  
  startTime = Date.now();
  const endTime = startTime + TEST_DURATION;
  
  // Schedule requests at regular intervals
  const interval = setInterval(async () => {
    if (Date.now() >= endTime) {
      clearInterval(interval);
      return;
    }
    
    // Select random method
    const { method, params } = weightedMethods[Math.floor(Math.random() * weightedMethods.length)];
    
    // Fire request without waiting (to maintain RPS)
    makeRequest(method, params).then(result => {
      results.push(result);
      
      // Log progress every 100 requests
      if (results.length % 100 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const currentRPS = results.length / elapsed;
        console.log(`Progress: ${results.length} requests, ${currentRPS.toFixed(1)} RPS`);
      }
    });
  }, REQUEST_INTERVAL);
  
  // Wait for test to complete
  await new Promise(resolve => setTimeout(resolve, TEST_DURATION + 5000)); // Extra 5s for pending requests
  
  // Calculate statistics
  printResults();
}

// Print test results
function printResults() {
  console.log(`\n📊 STRESS TEST RESULTS`);
  console.log(`${"=".repeat(50)}\n`);
  
  const totalRequests = results.length;
  const successfulRequests = results.filter(r => r.success).length;
  const failedRequests = results.filter(r => !r.success).length;
  const actualDuration = (Date.now() - startTime) / 1000;
  const actualRPS = totalRequests / actualDuration;
  
  console.log(`⏱️  Test Duration: ${actualDuration.toFixed(1)}s`);
  console.log(`📨 Total Requests: ${totalRequests}`);
  console.log(`✅ Successful: ${successfulRequests} (${((successfulRequests / totalRequests) * 100).toFixed(1)}%)`);
  console.log(`❌ Failed: ${failedRequests} (${((failedRequests / totalRequests) * 100).toFixed(1)}%)`);
  console.log(`🚀 Actual RPS: ${actualRPS.toFixed(1)}`);
  
  // Response time statistics
  const responseTimes = results.map(r => r.responseTime);
  const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
  const minResponseTime = Math.min(...responseTimes);
  const maxResponseTime = Math.max(...responseTimes);
  
  // Calculate percentiles
  const sorted = [...responseTimes].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  
  console.log(`\n📈 Response Times:`);
  console.log(`   Average: ${avgResponseTime.toFixed(0)}ms`);
  console.log(`   Min: ${minResponseTime}ms`);
  console.log(`   Max: ${maxResponseTime}ms`);
  console.log(`   P50: ${p50}ms`);
  console.log(`   P95: ${p95}ms`);
  console.log(`   P99: ${p99}ms`);
  
  // Method breakdown
  console.log(`\n🔍 Requests by Method:`);
  const methodStats = new Map<string, { count: number, success: number }>();
  results.forEach(r => {
    const stats = methodStats.get(r.method) || { count: 0, success: 0 };
    stats.count++;
    if (r.success) stats.success++;
    methodStats.set(r.method, stats);
  });
  
  methodStats.forEach((stats, method) => {
    const successRate = ((stats.success / stats.count) * 100).toFixed(1);
    console.log(`   ${method}: ${stats.count} requests (${successRate}% success)`);
  });
  
  // Error summary
  if (failedRequests > 0) {
    console.log(`\n⚠️  Error Summary:`);
    const errorCounts = new Map<string, number>();
    results.filter(r => !r.success).forEach(r => {
      const error = r.error || "Unknown error";
      errorCounts.set(error, (errorCounts.get(error) || 0) + 1);
    });
    
    errorCounts.forEach((count, error) => {
      console.log(`   ${error}: ${count} occurrences`);
    });
  }
  
  // Response time distribution
  console.log(`\n📊 Response Time Distribution:`);
  const buckets = [
    { label: "< 100ms", min: 0, max: 100, count: 0 },
    { label: "100-500ms", min: 100, max: 500, count: 0 },
    { label: "500ms-1s", min: 500, max: 1000, count: 0 },
    { label: "1-2s", min: 1000, max: 2000, count: 0 },
    { label: "2-5s", min: 2000, max: 5000, count: 0 },
    { label: "> 5s", min: 5000, max: Infinity, count: 0 }
  ];
  
  responseTimes.forEach(time => {
    const bucket = buckets.find(b => time >= b.min && time < b.max);
    if (bucket) bucket.count++;
  });
  
  buckets.forEach(bucket => {
    const percentage = ((bucket.count / totalRequests) * 100).toFixed(1);
    const bar = "█".repeat(Math.round(parseInt(percentage) / 2));
    console.log(`   ${bucket.label.padEnd(10)} ${bar} ${percentage}% (${bucket.count})`);
  });
  
  console.log(`\n✅ Stress test completed!`);
}

// Check proxy health before starting
async function checkHealth() {
  try {
    const healthUrl = PROXY_URL.replace("/rpc", "/health");
    const response = await fetch(healthUrl);
    if (response.ok) {
      const health = await response.json();
      console.log(`\n🏥 Proxy Health Check:`);
      console.log(`   Status: ${health.status}`);
      console.log(`   Healthy Endpoints: ${health.healthyEndpoints}/${health.rpcUrls}`);
      console.log(`   Current RPS: ${health.stats.requestsPerSecond?.toFixed(1) || 0}`);
      return true;
    }
  } catch (error) {
    console.error(`⚠️  Could not check proxy health: ${error}`);
  }
  return false;
}

// Main execution
async function main() {
  console.log(`\n🧪 Web3 RPC Proxy Stress Test`);
  console.log(`${"=".repeat(50)}`);
  
  // Check proxy health
  const healthy = await checkHealth();
  if (!healthy) {
    console.log(`\n⚠️  Warning: Could not verify proxy health. Continuing anyway...`);
  }
  
  // Run the stress test
  await runStressTest();
}

// Run the test
main().catch(console.error);