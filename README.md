# Web3 RPC Proxy Server

A high-performance Web3 RPC proxy server built with Bun that provides round-robin load balancing across multiple RPC endpoints.

## Features

- 🚀 Built with Bun for maximum performance
- 🔄 Intelligent round-robin with automatic failover
- 📊 Optimized for 30-70 requests per second sustained load
- 🛡️ Automatic error handling and endpoint health tracking
- 📈 Real-time statistics and detailed health monitoring
- 🔌 Connection pooling via Bun's native fetch
- 📝 Request logging with timestamps
- 🔒 Full CORS support for browser-based applications
- 📏 Configurable request size limits
- ⏱️ Request timeout protection (optimized for 5s max response time)
- 🚦 Proper HTTP status codes and JSON-RPC error responses
- 💾 Optional response caching for identical requests
- 🔀 Per-endpoint concurrent request limiting
- ❤️ Automatic unhealthy endpoint detection and recovery
- 📊 Detailed endpoint performance metrics
- 🔁 Smart retry logic with up to 2 additional endpoints on failure

## Installation

1. Install Bun (if not already installed):
```bash
curl -fsSL https://bun.sh/install | bash
```

2. Install dependencies:
```bash
cd web3-rpc-proxy
bun install
```

## Configuration

Configure the server using environment variables:

- `PORT`: Server port (default: 3000)
- `RPC_URLS`: Comma-separated list of RPC endpoints
- `CORS_ORIGINS`: Comma-separated list of allowed origins (default: "*" for all origins)
- `MAX_REQUEST_SIZE`: Maximum request size in bytes (default: 1048576 = 1MB)
- `REQUEST_TIMEOUT`: Request timeout in milliseconds (default: 6000 = 6s)
- `MAX_CONCURRENT_REQUESTS`: Max concurrent requests per endpoint (default: 200)
- `ENABLE_CACHE`: Enable response caching for identical requests (default: false)
- `CACHE_TTL`: Cache time-to-live in milliseconds (default: 1000 = 1s)
- `DEBUG`: Enable debug mode for verbose logging (default: false)
- `MAX_RETRY_ATTEMPTS`: Maximum additional RPC attempts on failure (default: 2)

Example `.env` file:
```bash
PORT=3000
RPC_URLS="https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY,https://mainnet.infura.io/v3/YOUR_KEY,https://rpc.ankr.com/eth"
CORS_ORIGINS="https://myapp.com,https://app.myapp.com"
MAX_REQUEST_SIZE=2097152  # 2MB
REQUEST_TIMEOUT=6000      # 6 seconds
MAX_CONCURRENT_REQUESTS=200
ENABLE_CACHE=true
CACHE_TTL=1000           # 1 second
DEBUG=false              # Set to true for verbose logging
MAX_RETRY_ATTEMPTS=2     # Try up to 2 additional endpoints on failure
```

## Usage

### Start the server

```bash
bun start
```

### Development mode (with auto-reload)

```bash
bun dev
```

### Build standalone executable

```bash
bun build
```

### Run stress test

```bash
bun stress-test
```

Run a 20-second stress test at 50 RPS to verify performance:
```bash
# Test against custom proxy URL
PROXY_URL=http://localhost:8080/rpc bun stress-test

# Test with custom RPS target
TARGET_RPS=70 bun stress-test
```

## API Endpoints

### `/rpc` - JSON-RPC Proxy

Forward JSON-RPC requests to load-balanced RPC endpoints.

**Method:** POST  
**Content-Type:** application/json

**Example Request:**
```bash
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "eth_blockNumber",
    "params": [],
    "id": 1
  }'
```

### `/health` - Health Check

Get server statistics and health information.

**Method:** GET

**Example Response:**
```json
{
  "status": "healthy",
  "stats": {
    "totalRequests": 1523,
    "successfulRequests": 1520,
    "failedRequests": 3,
    "uptime": 3600000,
    "requestsPerSecond": 42.3
  },
  "rpcUrls": 8,
  "healthyEndpoints": 7,
  "totalActiveRequests": 15,
  "currentIndex": 3,
  "endpoints": [
    {
      "url": "https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY",
      "isHealthy": true,
      "activeRequests": 5,
      "totalRequests": 450,
      "totalFailures": 2,
      "failureRate": "0.44%",
      "averageResponseTime": 125
    }
  ],
  "cache": {
    "enabled": true,
    "size": 42,
    "ttl": 1000
  },
  "config": {
    "maxConcurrentRequests": 200,
    "requestTimeout": 6000,
    "maxRequestSize": 1048576
  }
}
```

## Performance

The server is optimized for high-throughput scenarios (30-70 RPS sustained):

- Intelligent load balancing with health-aware endpoint selection
- Automatic failover for unhealthy endpoints
- Per-endpoint concurrent request limiting prevents overwhelming
- Optional response caching reduces duplicate requests
- Non-blocking async operations with 6s timeout
- Automatic connection pooling via Bun
- Real-time performance metrics per endpoint
- Graceful degradation under heavy load

## Default RPC Endpoints

If no `RPC_URLS` environment variable is provided, the server uses these default endpoints:

1. Alchemy Demo
2. Infura Demo
3. Ankr
4. LlamaRPC
5. 1RPC
6. PublicNode
7. Flashbots
8. Cloudflare

**Note:** Replace demo endpoints with your own API keys for production use.

## Error Handling

The proxy includes comprehensive error handling:

- Invalid JSON-RPC requests return appropriate error codes
- Failed upstream requests are logged with details
- Statistics track both successful and failed requests
- Graceful shutdown on SIGINT
- Request size validation (413 Payload Too Large)
- Request timeout protection (504 Gateway Timeout)
- Method validation (405 Method Not Allowed)
- CORS preflight handling for browser requests

### JSON-RPC Error Codes

- `-32600`: Invalid Request - Missing required fields
- `-32700`: Parse error - Malformed JSON
- `-32603`: Internal error - Upstream RPC failure
- `-32050`: Request timeout - Upstream took too long
- `-32601`: Method not allowed - Wrong HTTP method

## Monitoring

Monitor server performance using the `/health` endpoint which provides:

- Overall server statistics (requests, success/failure rates, RPS)
- Per-endpoint health status and metrics
- Active request counts per endpoint
- Average response times
- Failure rates and last failure timestamps
- Cache statistics (if enabled)
- Current configuration values

The server also logs unhealthy endpoints every 30 seconds for operational awareness.

## Stress Testing

The included stress test tool (`stress-test.ts`) simulates realistic load patterns:

- Generates target RPS using multiple concurrent request streams
- Default 50 RPS for 20 seconds (configurable via TARGET_RPS env var)
- Uses weighted distribution of common RPC methods
- Tracks response times and success rates
- Provides detailed performance metrics including percentiles
- Shows response time distribution across buckets

Example output:
```
📊 STRESS TEST RESULTS
==================================================

⏱️  Test Duration: 25.1s
📨 Total Requests: 1000
✅ Successful: 985 (98.5%)
❌ Failed: 15 (1.5%)
🚀 Actual RPS: 39.8

📈 Response Times:
   Average: 245ms
   Min: 12ms
   Max: 4932ms
   P50: 178ms
   P95: 623ms
   P99: 2145ms
```

## Production Deployment

For production use:

1. Set proper RPC URLs with your API keys
2. Configure appropriate rate limits
3. Set up monitoring for the health endpoint
4. Consider using a process manager (PM2, systemd)
5. Enable HTTPS termination via reverse proxy
6. Configure CORS origins to match your frontend domains
7. Adjust request timeout based on your RPC provider performance
8. Set appropriate request size limits for your use case

## License

MIT