export interface JSONRPCRequest {
  jsonrpc: string;
  method: string;
  params?: any[];
  id: number | string;
}

export interface JSONRPCResponse {
  jsonrpc: string;
  result?: any;
  error?: JSONRPCError;
  id: number | string;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: any;
}

export interface ProxyConfig {
  rpcUrls: string[];
  port: number;
  maxRetries?: number;
  requestTimeout?: number;
}

export interface RequestStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  lastError?: string;
  uptime: number;
  requestsPerSecond: number;
}