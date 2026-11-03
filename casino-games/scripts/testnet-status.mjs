const RPC = process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org';
const addresses = {
  token: process.env.C888T_ADDRESS || '',
  escrow: process.env.C888_ESCROW_ADDRESS || '',
};

const rpc = async (method, params = []) => {
  const response = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || `RPC ${response.status}`);
  return data.result;
};

const chainId = Number(await rpc('eth_chainId'));
if (chainId !== 84532) throw new Error(`Expected Base Sepolia 84532, received ${chainId}`);
const block = Number(await rpc('eth_blockNumber'));
console.log(JSON.stringify({ network: 'Base Sepolia', chainId, block, contracts: addresses, deployed: Boolean(addresses.token && addresses.escrow), value: 'TESTNET ONLY - NO VALUE' }, null, 2));
