import { serve } from "bun";
import type { JSONRPCRequest, JSONRPCResponse, RequestStats } from "./types";

// Configuration
const PORT = parseInt(process.env.PORT || "3000");
const RPC_URLS = process.env.RPC_URLS?.split(",") || [
  //"https://arbitrum-one-rpc.publicnode.com",
  //"https://arb1.lava.build",
  //"https://arbitrum.drpc.org",
  //"https://1rpc.io/arb",
  //"https://arbitrum-one-public.nodies.app",
];

// CORS configuration
const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(",") || ["*"];
const MAX_REQUEST_SIZE = parseInt(process.env.MAX_REQUEST_SIZE || "1048576"); // 1MB default
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || "6000"); // 6s default (5s max + buffer)
const MAX_CONCURRENT_REQUESTS = parseInt(process.env.MAX_CONCURRENT_REQUESTS || "200"); // Per endpoint
const ENABLE_CACHE = process.env.ENABLE_CACHE === "true";
const CACHE_TTL = parseInt(process.env.CACHE_TTL || "1000"); // 1 second cache for identical requests
const DEBUG = process.env.DEBUG === "true"; // Debug mode for verbose logging
const MAX_RETRY_ATTEMPTS = parseInt(process.env.MAX_RETRY_ATTEMPTS || "2"); // Max additional RPC attempts on failure

// Atomic counter for round-robin rotation
let currentIndex = 0;
const startTime = Date.now();

// Request statistics with proper initialization
const stats: RequestStats = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  uptime: 0,
  requestsPerSecond: 0,
  rpcErrors: 0,  // Normal RPC errors (like insufficient gas)
  proxyErrors: 0  // Real proxy/endpoint failures
} as RequestStats;

// Request tracking for RPS calculation
let requestCounts: number[] = [];
let lastSecond = Math.floor(Date.now() / 1000);

// Error classification patterns
const ENDPOINT_FAILURE_PATTERNS = [
  // Rate limiting patterns
  /rate.?limit/i,
  /too many requests/i,
  /request.?limit.?exceeded/i,
  /throttl/i,
  /429/,
  
  // Resource/credit patterns
  /RU credits/i,
  /compute.?units/i,
  /quota.?exceeded/i,
  /insufficient.?credits/i,
  
  // Connection/network errors
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /socket hang up/i,
  /network error/i,
  /connection.?(refused|reset|closed)/i,
  /timeout/i,
  
  // Service unavailable
  /service.?unavailable/i,
  /503/,
  /502/,
  /gateway/i,
  
  // Internal/server errors
  /internal.?server.?error/i,
  /500/
];

// Common RPC errors that are NOT endpoint failures
const NORMAL_RPC_ERROR_PATTERNS = [
  /intrinsic gas/i,
  /insufficient.?funds/i,
  /nonce too (low|high)/i,
  /transaction.?underpriced/i,
  /invalid.?argument/i,
  /execution.?reverted/i,
  /contract.?call.?exception/i,
  /invalid.?signature/i,
  /gas.?limit/i,
  /already known/i,
  /replacement.?transaction/i
];

// Function to classify error type
function isEndpointFailure(error: any): boolean {
  if (!error) return false;
  
  const errorStr = typeof error === 'string' ? error : 
                   error.message || error.data || JSON.stringify(error);
  
  // First check if it's a known normal RPC error
  for (const pattern of NORMAL_RPC_ERROR_PATTERNS) {
    if (pattern.test(errorStr)) {
      return false; // It's a normal RPC error, not an endpoint failure
    }
  }
  
  // Then check if it matches endpoint failure patterns
  for (const pattern of ENDPOINT_FAILURE_PATTERNS) {
    if (pattern.test(errorStr)) {
      return true; // It's an endpoint failure
    }
  }
  
  // Default: treat unknown errors as normal RPC errors
  return false;
}

// Endpoint health tracking
interface EndpointHealth {
  url: string;
  isHealthy: boolean;
  consecutiveFailures: number;
  lastFailure?: Date;
  activeRequests: number;
  totalRequests: number;
  totalFailures: number;
  averageResponseTime: number;
  responseTimeSamples: number[];
}

const endpointHealth: Map<string, EndpointHealth> = new Map();

// Initialize endpoint health
RPC_URLS.forEach(url => {
  endpointHealth.set(url, {
    url,
    isHealthy: true,
    consecutiveFailures: 0,
    activeRequests: 0,
    totalRequests: 0,
    totalFailures: 0,
    averageResponseTime: 0,
    responseTimeSamples: []
  });
});

// Simple request cache
interface CacheEntry {
  response: JSONRPCResponse;
  timestamp: number;
}
const requestCache = new Map<string, CacheEntry>();

// Simple round-robin without atomics (Bun is single-threaded by default)
function getNextRpcUrlSimple(): string {
  let attempts = 0;
  while (attempts < RPC_URLS.length) {
    const url = RPC_URLS[currentIndex];
    currentIndex = (currentIndex + 1) % RPC_URLS.length;
    
    const health = endpointHealth.get(url);
    if (health && health.isHealthy && health.activeRequests < MAX_CONCURRENT_REQUESTS) {
      return url;
    }
    attempts++;
  }
  
  // If all endpoints are unhealthy or at capacity, return the least loaded one
  let bestUrl = RPC_URLS[0];
  let lowestActiveRequests = Infinity;
  
  for (const [url, health] of endpointHealth) {
    if (health.activeRequests < lowestActiveRequests) {
      lowestActiveRequests = health.activeRequests;
      bestUrl = url;
    }
  }
  
  return bestUrl;
}

// Get alternative RPC URLs for retry (doesn't affect global round-robin)
function getRetryRpcUrls(failedUrl: string, maxRetries: number): string[] {
  const retryUrls: string[] = [];
  const startIdx = RPC_URLS.indexOf(failedUrl);
  if (startIdx === -1) return retryUrls;
  
  let attempts = 0;
  let idx = (startIdx + 1) % RPC_URLS.length;
  
  while (retryUrls.length < maxRetries && attempts < RPC_URLS.length) {
    const url = RPC_URLS[idx];
    const health = endpointHealth.get(url);
    
    // Only use healthy endpoints with capacity for retries
    if (url !== failedUrl && health && health.isHealthy && health.activeRequests < MAX_CONCURRENT_REQUESTS) {
      retryUrls.push(url);
    }
    
    idx = (idx + 1) % RPC_URLS.length;
    attempts++;
  }
  
  return retryUrls;
}

// Generate CORS headers based on request origin
function getCORSHeaders(req: Request): Headers {
  const headers = new Headers();
  const origin = req.headers.get("origin");
  
  // Check if origin is allowed
  if (CORS_ORIGINS.includes("*") || (origin && CORS_ORIGINS.includes(origin))) {
    headers.set("Access-Control-Allow-Origin", origin || "*");
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    headers.set("Access-Control-Max-Age", "86400"); // 24 hours
  }
  
  return headers;
}

// Update endpoint health based on request outcome
function updateEndpointHealth(url: string, success: boolean, responseTime?: number) {
  const health = endpointHealth.get(url);
  if (!health) return;
  
  health.totalRequests++;
  
  if (success) {
    health.consecutiveFailures = 0;
    if (responseTime !== undefined) {
      health.responseTimeSamples.push(responseTime);
      // Keep only last 100 samples
      if (health.responseTimeSamples.length > 100) {
        health.responseTimeSamples.shift();
      }
      health.averageResponseTime = health.responseTimeSamples.reduce((a, b) => a + b, 0) / health.responseTimeSamples.length;
    }
    
    // Mark as healthy if it was unhealthy
    if (!health.isHealthy) {
      health.isHealthy = true;
      if (DEBUG) console.log(`✅ Endpoint ${url} is now healthy`);
    }
  } else {
    health.totalFailures++;
    health.consecutiveFailures++;
    health.lastFailure = new Date();
    
    // Mark as unhealthy after 3 consecutive failures
    if (health.consecutiveFailures >= 3 && health.isHealthy) {
      health.isHealthy = false;
      console.error(`❌ Endpoint ${url} marked as unhealthy after ${health.consecutiveFailures} failures`);
    }
  }
}

// Generate cache key for request
function getCacheKey(request: JSONRPCRequest): string {
  return `${request.method}:${JSON.stringify(request.params || [])}`;
}

// Clean old cache entries
function cleanCache() {
  const now = Date.now();
  for (const [key, entry] of requestCache) {
    if (now - entry.timestamp > CACHE_TTL) {
      requestCache.delete(key);
    }
  }
}

// Update request per second statistics
function updateRPS() {
  const currentSecond = Math.floor(Date.now() / 1000);
  
  if (currentSecond !== lastSecond) {
    // Keep only last 10 seconds of data
    if (requestCounts.length >= 10) {
      requestCounts.shift();
    }
    requestCounts.push(0);
    lastSecond = currentSecond;
  }
  
  if (requestCounts.length > 0) {
    requestCounts[requestCounts.length - 1]++;
  }
  
  // Calculate average RPS over the last few seconds
  const totalRequests = requestCounts.reduce((sum, count) => sum + count, 0);
  stats.requestsPerSecond = totalRequests / Math.max(1, requestCounts.length);
}

// Proxy request with retry logic
async function proxyRequestWithRetry(request: JSONRPCRequest): Promise<JSONRPCResponse> {
  const primaryUrl = getNextRpcUrlSimple();
  let lastError: JSONRPCResponse | null = null;
  
  // Try primary endpoint
  const primaryResult = await proxyRequest(request, primaryUrl);
  if (!primaryResult.error) {
    return primaryResult;
  }
  
  lastError = primaryResult;
  
  // If primary fails and retries are enabled, try alternative endpoints
  if (MAX_RETRY_ATTEMPTS > 0) {
    const retryUrls = getRetryRpcUrls(primaryUrl, MAX_RETRY_ATTEMPTS);
    
    if (DEBUG && retryUrls.length > 0) {
      console.log(`[RETRY] Primary endpoint ${primaryUrl} failed, trying ${retryUrls.length} alternatives`);
    }
    
    for (const retryUrl of retryUrls) {
      const retryResult = await proxyRequest(request, retryUrl);
      if (!retryResult.error) {
        if (DEBUG) {
          console.log(`[RETRY] Success with ${retryUrl}`);
        }
        return retryResult;
      }
      lastError = retryResult;
    }
  }
  
  // All attempts failed, return last error
  return lastError;
}

// Proxy JSON-RPC request to selected endpoint
async function proxyRequest(request: JSONRPCRequest, rpcUrl: string): Promise<JSONRPCResponse> {
  const startTime = Date.now();
  const health = endpointHealth.get(rpcUrl);
  
  if (health) {
    health.activeRequests++;
  }
  
  try {
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Web3-RPC-Proxy/1.0"
      },
      body: JSON.stringify(request),
      signal: controller.signal,
      // Bun automatically handles connection pooling
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json() as JSONRPCResponse;
    
    // Check if response contains an RPC error that indicates endpoint failure
    if (data.error && isEndpointFailure(data.error)) {
      // This is an endpoint failure (rate limit, credits, etc.)
      updateEndpointHealth(rpcUrl, false);
      if (DEBUG) {
        console.error(`[ENDPOINT FAILURE] ${rpcUrl}: ${data.error.message || JSON.stringify(data.error)}`);
      }
    } else {
      // Success or normal RPC error
      const responseTime = Date.now() - startTime;
      updateEndpointHealth(rpcUrl, true, responseTime);
    }
    
    return data;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const isTimeout = error instanceof Error && error.name === "AbortError";
    if (DEBUG || isTimeout) {
      console.error(`[ERROR] RPC request failed for ${rpcUrl}:`, errorMessage);
    }
    
    // Update health metrics on failure
    updateEndpointHealth(rpcUrl, false);
    
    return {
      jsonrpc: "2.0",
      error: {
        code: isTimeout ? -32050 : -32603,
        message: isTimeout ? "Request timeout" : "Internal error",
        data: errorMessage
      },
      id: request.id
    };
  } finally {
    if (health) {
      health.activeRequests--;
    }
  }
}

// Main server
const server = serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const corsHeaders = getCORSHeaders(req);
    
    // Handle CORS preflight requests
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }
    
    // Health check endpoint
    if (url.pathname === "/health") {
      stats.uptime = Date.now() - startTime;
      const headers = new Headers(corsHeaders);
      headers.set("Content-Type", "application/json");
      
      // Prepare endpoint health data
      const endpoints = Array.from(endpointHealth.values()).map(health => ({
        url: health.url,
        isHealthy: health.isHealthy,
        activeRequests: health.activeRequests,
        totalRequests: health.totalRequests,
        totalFailures: health.totalFailures,
        failureRate: health.totalRequests > 0 ? (health.totalFailures / health.totalRequests * 100).toFixed(2) + '%' : '0%',
        averageResponseTime: Math.round(health.averageResponseTime),
        lastFailure: health.lastFailure
      }));
      
      const healthyEndpoints = endpoints.filter(e => e.isHealthy).length;
      const totalActiveRequests = endpoints.reduce((sum, e) => sum + e.activeRequests, 0);
      
      return new Response(JSON.stringify({
        status: healthyEndpoints > 0 ? "healthy" : "degraded",
        stats: {
          ...stats,
          successRate: stats.totalRequests > 0 ? 
            ((stats.successfulRequests / stats.totalRequests) * 100).toFixed(2) + '%' : '0%',
          proxyFailureRate: stats.totalRequests > 0 ? 
            (((stats.proxyErrors || 0) / stats.totalRequests) * 100).toFixed(2) + '%' : '0%'
        },
        rpcUrls: RPC_URLS.length,
        healthyEndpoints,
        totalActiveRequests,
        currentIndex,
        endpoints,
        cache: {
          enabled: ENABLE_CACHE,
          size: requestCache.size,
          ttl: CACHE_TTL
        },
        config: {
          maxConcurrentRequests: MAX_CONCURRENT_REQUESTS,
          requestTimeout: REQUEST_TIMEOUT,
          maxRequestSize: MAX_REQUEST_SIZE
        }
      }), {
        headers
      });
    }
    
    // RPC proxy endpoint
    if (url.pathname === "/rpc" && req.method === "POST") {
      stats.totalRequests++;
      updateRPS();
      
      try {
        // Check request size
        const contentLength = req.headers.get("content-length");
        if (contentLength && parseInt(contentLength) > MAX_REQUEST_SIZE) {
          stats.failedRequests++;
          const headers = new Headers(corsHeaders);
          headers.set("Content-Type", "application/json");
          
          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32700,
              message: "Request too large"
            },
            id: null
          }), {
            status: 413,
            headers
          });
        }
        
        const body = await req.json() as JSONRPCRequest;
        
        // Validate JSON-RPC request
        if (!body.jsonrpc || !body.method) {
          stats.failedRequests++;
          const headers = new Headers(corsHeaders);
          headers.set("Content-Type", "application/json");
          
          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32600,
              message: "Invalid Request"
            },
            id: body.id || null
          }), {
            status: 400,
            headers
          });
        }
        
        // Check cache if enabled
        let response: JSONRPCResponse;
        const cacheKey = getCacheKey(body);
        
        if (ENABLE_CACHE) {
          const cached = requestCache.get(cacheKey);
          if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            response = { ...cached.response, id: body.id };
            if (DEBUG) console.log(`[${new Date().toISOString()}] Cache hit for ${body.method}`);
          } else {
            // Clean old cache entries periodically
            if (requestCache.size > 1000) {
              cleanCache();
            }
            
            // Proxy request with retry logic
            response = await proxyRequestWithRetry(body);
            
            // Cache successful responses
            if (!response.error && ENABLE_CACHE) {
              requestCache.set(cacheKey, {
                response,
                timestamp: Date.now()
              });
            }
          }
        } else {
          // Proxy request with retry logic
          response = await proxyRequestWithRetry(body);
        }
        
        // Update statistics based on error classification
        if (response.error) {
          if (isEndpointFailure(response.error)) {
            // This is a real proxy/endpoint failure
            stats.failedRequests++;
            stats.proxyErrors = (stats.proxyErrors || 0) + 1;
            stats.lastError = `[PROXY] ${response.error.message || JSON.stringify(response.error)}`;
          } else {
            // Normal RPC error (like insufficient gas)
            stats.rpcErrors = (stats.rpcErrors || 0) + 1;
            stats.successfulRequests++; // Count as successful proxy operation
            stats.lastRpcError = response.error.message || JSON.stringify(response.error);
          }
        } else {
          stats.successfulRequests++;
        }
        
        const headers = new Headers(corsHeaders);
        headers.set("Content-Type", "application/json");
        
        return new Response(JSON.stringify(response), {
          headers
        });
        
      } catch (error) {
        stats.failedRequests++;
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        stats.lastError = errorMessage;
        if (DEBUG) console.error("[ERROR] Request processing failed:", errorMessage);
        
        const headers = new Headers(corsHeaders);
        headers.set("Content-Type", "application/json");
        
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32700,
            message: "Parse error"
          },
          id: null
        }), {
          status: 400,
          headers
        });
      }
    }
    
    // Only allow POST to /rpc
    if (url.pathname === "/rpc") {
      const headers = new Headers(corsHeaders);
      headers.set("Content-Type", "application/json");
      
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32601,
          message: "Method not allowed"
        },
        id: null
      }), {
        status: 405,
        headers
      });
    }
    
    // Default 404 response
    return new Response("Not Found", { 
      status: 404,
      headers: corsHeaders
    });
  },
});

console.log(`🚀 Web3 RPC Proxy Server running on http://localhost:${PORT}`);
console.log(`📡 Configured with ${RPC_URLS.length} RPC endpoints`);
console.log(`🔄 Using intelligent round-robin with health tracking`);
console.log(`🔁 Retry on failure: ${MAX_RETRY_ATTEMPTS > 0 ? `Enabled (max ${MAX_RETRY_ATTEMPTS} retries)` : 'Disabled'}`);
console.log(`🐛 Debug mode: ${DEBUG ? 'Enabled' : 'Disabled'}`);
if (DEBUG) {
  console.log(`🔒 CORS enabled for origins: ${CORS_ORIGINS.join(", ")}`);
  console.log(`📏 Max request size: ${(MAX_REQUEST_SIZE / 1024 / 1024).toFixed(2)}MB`);
  console.log(`⏱️  Request timeout: ${REQUEST_TIMEOUT / 1000}s`);
  console.log(`🔀 Max concurrent requests per endpoint: ${MAX_CONCURRENT_REQUESTS}`);
  console.log(`💾 Response caching: ${ENABLE_CACHE ? `Enabled (TTL: ${CACHE_TTL}ms)` : 'Disabled'}`);
}
console.log(`\n📊 Health check available at: http://localhost:${PORT}/health`);
console.log(`🌐 RPC endpoint: http://localhost:${PORT}/rpc`);

// Periodic health check and recovery (every 30 seconds)
setInterval(async () => {
  const unhealthyEndpoints = Array.from(endpointHealth.values()).filter(h => !h.isHealthy);
  
  if (unhealthyEndpoints.length > 0) {
    console.log(`\n⚠️  ${unhealthyEndpoints.length} unhealthy endpoints detected`);
    
    // Try to recover unhealthy endpoints
    for (const endpoint of unhealthyEndpoints) {
      const timeSinceFailure = endpoint.lastFailure ? 
        Math.round((Date.now() - endpoint.lastFailure.getTime()) / 1000) : 0;
      
      // If it's been more than 60 seconds since last failure, try a health check
      if (timeSinceFailure > 60) {
        try {
          console.log(`  🔄 Attempting recovery for ${endpoint.url}...`);
          
          // Simple health check - try eth_blockNumber
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          
          const response = await fetch(endpoint.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "eth_blockNumber",
              params: [],
              id: 1
            }),
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          if (response.ok) {
            const data = await response.json();
            if (!data.error || !isEndpointFailure(data.error)) {
              // Recovery successful!
              endpoint.isHealthy = true;
              endpoint.consecutiveFailures = 0;
              console.log(`  ✅ Recovered: ${endpoint.url}`);
            } else {
              console.log(`  ❌ Recovery failed: ${endpoint.url} - Still returning errors`);
            }
          }
        } catch (error) {
          console.log(`  ❌ Recovery failed: ${endpoint.url} - ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      } else {
        console.log(`  - ${endpoint.url}: ${endpoint.consecutiveFailures} failures, last ${timeSinceFailure}s ago`);
      }
    }
  }
}, 30000);

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n👋 Shutting down server...");
  server.stop();
  process.exit(0);
});