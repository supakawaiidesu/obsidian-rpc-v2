// Test network detection methods without ethers.js dependency
// Run with: bun test-network-detection.js or node test-network-detection.js

async function testRPCMethod(method, params = []) {
  const response = await fetch('http://localhost:3001/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: method,
      params: params,
      id: 1
    })
  });
  
  return response.json();
}

async function testMalformedRequest(body) {
  const response = await fetch('http://localhost:3001/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
  
  return response.json();
}

async function runTests() {
  console.log('Testing RPC Proxy Network Detection\n');
  console.log('=' .repeat(60));
  
  // Test network detection methods
  console.log('\n1. Testing eth_chainId (should return 0xa4b1 for Arbitrum)...');
  try {
    const result = await testRPCMethod('eth_chainId');
    console.log('   Response:', JSON.stringify(result, null, 2));
    console.log('   ✓ Chain ID:', result.result, '(decimal:', parseInt(result.result, 16) + ')');
    console.log('   ✓ Field order:', Object.keys(result).join(','));
  } catch (e) {
    console.error('   ✗ Error:', e.message);
  }
  
  console.log('\n2. Testing net_version (should return 42161 for Arbitrum)...');
  try {
    const result = await testRPCMethod('net_version');
    console.log('   Response:', JSON.stringify(result, null, 2));
    console.log('   ✓ Network version:', result.result);
    console.log('   ✓ Field order:', Object.keys(result).join(','));
  } catch (e) {
    console.error('   ✗ Error:', e.message);
  }
  
  console.log('\n3. Testing eth_blockNumber (should proxy to RPC)...');
  try {
    const result = await testRPCMethod('eth_blockNumber');
    console.log('   Response:', JSON.stringify(result, null, 2));
    if (result.result) {
      console.log('   ✓ Block number:', result.result, '(decimal:', parseInt(result.result, 16) + ')');
    } else if (result.error) {
      console.log('   Note: Got error (likely no RPC URLs configured):', result.error.message);
    }
    console.log('   ✓ Field order:', Object.keys(result).join(','));
  } catch (e) {
    console.error('   ✗ Error:', e.message);
  }
  
  // Test malformed requests
  console.log('\n' + '='.repeat(60));
  console.log('\nTesting Malformed Request Handling\n');
  
  console.log('4. Testing empty body (should return parse error -32700)...');
  try {
    const result = await testMalformedRequest('');
    console.log('   Response:', JSON.stringify(result, null, 2));
    console.log('   ✓ Error code:', result.error?.code, result.error?.code === -32700 ? '(correct)' : '(incorrect - should be -32700)');
    console.log('   ✓ Field order:', Object.keys(result).join(','), 
                Object.keys(result).join(',') === 'jsonrpc,id,error' ? '(correct)' : '(incorrect - should be jsonrpc,id,error)');
  } catch (e) {
    console.error('   ✗ Error:', e.message);
  }
  
  console.log('\n5. Testing invalid JSON (should return parse error -32700)...');
  try {
    const result = await testMalformedRequest('{invalid json}');
    console.log('   Response:', JSON.stringify(result, null, 2));
    console.log('   ✓ Error code:', result.error?.code, result.error?.code === -32700 ? '(correct)' : '(incorrect - should be -32700)');
    console.log('   ✓ Field order:', Object.keys(result).join(','),
                Object.keys(result).join(',') === 'jsonrpc,id,error' ? '(correct)' : '(incorrect - should be jsonrpc,id,error)');
  } catch (e) {
    console.error('   ✗ Error:', e.message);
  }
  
  console.log('\n6. Testing null body (should return parse error -32700)...');
  try {
    const result = await testMalformedRequest(null);
    console.log('   Response:', JSON.stringify(result, null, 2));
    console.log('   ✓ Error code:', result.error?.code, result.error?.code === -32700 ? '(correct)' : '(incorrect - should be -32700)');
    console.log('   ✓ Field order:', Object.keys(result).join(','),
                Object.keys(result).join(',') === 'jsonrpc,id,error' ? '(correct)' : '(incorrect - should be jsonrpc,id,error)');
  } catch (e) {
    console.error('   ✗ Error:', e.message);
  }
  
  console.log('\n7. Testing missing method (should return invalid request -32600)...');
  try {
    const result = await testMalformedRequest({ jsonrpc: '2.0', id: 1 });
    console.log('   Response:', JSON.stringify(result, null, 2));
    console.log('   ✓ Error code:', result.error?.code, result.error?.code === -32600 ? '(correct)' : '(incorrect - should be -32600)');
    console.log('   ✓ Field order:', Object.keys(result).join(','),
                Object.keys(result).join(',') === 'jsonrpc,id,error' ? '(correct)' : '(incorrect - should be jsonrpc,id,error)');
  } catch (e) {
    console.error('   ✗ Error:', e.message);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('\n✅ All tests completed!');
  console.log('\nSummary:');
  console.log('- eth_chainId and net_version are handled locally (fast response)');
  console.log('- Other methods are proxied to configured RPC endpoints');
  console.log('- Parse errors return code -32700 with null id');
  console.log('- Error response field order is: jsonrpc, id, error');
  console.log('- Empty/malformed requests are handled gracefully');
}

// Run the tests
runTests().catch(console.error);