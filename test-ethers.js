// Test ethers.js v6 network detection with the RPC proxy
// Run with: node test-ethers.js

import { ethers } from 'ethers';

async function testEthersConnection() {
  console.log('Testing ethers.js v6 connection to RPC proxy...\n');
  
  try {
    // Create provider pointing to local RPC proxy
    const provider = new ethers.JsonRpcProvider('http://localhost:3000/rpc');
    
    console.log('1. Testing network detection...');
    const network = await provider.getNetwork();
    console.log('   Network detected:', {
      chainId: network.chainId.toString(),
      name: network.name
    });
    
    console.log('\n2. Testing eth_chainId...');
    const chainId = await provider.send('eth_chainId', []);
    console.log('   Chain ID (hex):', chainId);
    console.log('   Chain ID (decimal):', parseInt(chainId, 16));
    
    console.log('\n3. Testing net_version...');
    const netVersion = await provider.send('net_version', []);
    console.log('   Network version:', netVersion);
    
    console.log('\n4. Testing eth_blockNumber...');
    const blockNumber = await provider.getBlockNumber();
    console.log('   Current block:', blockNumber);
    
    console.log('\n5. Testing getBlock...');
    const block = await provider.getBlock('latest');
    console.log('   Latest block:', {
      number: block.number,
      hash: block.hash,
      timestamp: block.timestamp
    });
    
    console.log('\n✅ All tests passed! Ethers.js v6 can connect successfully.');
    
  } catch (error) {
    console.error('❌ Error during testing:', error.message);
    if (error.code) {
      console.error('   Error code:', error.code);
    }
    if (error.data) {
      console.error('   Error data:', error.data);
    }
  }
}

// Test malformed requests
async function testMalformedRequests() {
  console.log('\n\nTesting malformed request handling...\n');
  
  try {
    // Test empty body
    console.log('1. Testing empty body request...');
    const response1 = await fetch('http://localhost:3000/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: ''
    });
    const data1 = await response1.json();
    console.log('   Response:', data1);
    console.log('   Field order correct:', Object.keys(data1).join(', ') === 'jsonrpc,id,error' ? '✓' : '✗');
    
    // Test invalid JSON
    console.log('\n2. Testing invalid JSON...');
    const response2 = await fetch('http://localhost:3000/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid json}'
    });
    const data2 = await response2.json();
    console.log('   Response:', data2);
    console.log('   Field order correct:', Object.keys(data2).join(', ') === 'jsonrpc,id,error' ? '✓' : '✗');
    
    // Test missing method
    console.log('\n3. Testing missing method...');
    const response3 = await fetch('http://localhost:3000/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1 })
    });
    const data3 = await response3.json();
    console.log('   Response:', data3);
    console.log('   Field order correct:', Object.keys(data3).join(', ') === 'jsonrpc,id,error' ? '✓' : '✗');
    
  } catch (error) {
    console.error('❌ Error during malformed request testing:', error.message);
  }
}

// Run tests
(async () => {
  console.log('Starting RPC proxy tests for ethers.js v6 compatibility\n');
  console.log('Make sure the RPC proxy is running on http://localhost:3000\n');
  console.log('=' .repeat(60));
  
  await testEthersConnection();
  await testMalformedRequests();
  
  console.log('\n' + '='.repeat(60));
  console.log('Tests completed!');
})();