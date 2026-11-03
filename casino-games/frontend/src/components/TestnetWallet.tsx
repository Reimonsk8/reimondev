import { useEffect, useState } from 'react';
import { Link, ShieldCheck, Wallet } from 'lucide-react';
import { apiCall } from '../utils/api';

const CHAIN_ID = '0x14a34';
const BASE_SEPOLIA = { chainId: CHAIN_ID, chainName: 'Base Sepolia', nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://sepolia.base.org'], blockExplorerUrls: ['https://sepolia.basescan.org'] };

type Provider = { request: (args: { method: string; params?: unknown[] }) => Promise<any>; on?: (event: string, listener: () => void) => void; removeListener?: (event: string, listener: () => void) => void };

export default function TestnetWallet() {
  const [linked, setLinked] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const provider = (window as any).ethereum as Provider | undefined;

  useEffect(() => { apiCall('/wallet/link', 'GET', null, true).then((data) => setLinked(data.address)).catch(() => {}); }, []);

  const connect = async () => {
    if (!provider) return setStatus('Install a compatible self-custody wallet extension.');
    setStatus('Connecting...');
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      let chainId = await provider.request({ method: 'eth_chainId' });
      if (chainId !== CHAIN_ID) {
        try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID }] }); }
        catch (error: any) {
          if (error?.code !== 4902) throw error;
          await provider.request({ method: 'wallet_addEthereumChain', params: [BASE_SEPOLIA] });
        }
        chainId = await provider.request({ method: 'eth_chainId' });
      }
      if (chainId !== CHAIN_ID) throw new Error('Base Sepolia required');
      const address = accounts[0];
      const nonce = await apiCall('/wallet/link/nonce', 'POST', { address }, true);
      const signature = await provider.request({ method: 'personal_sign', params: [nonce.message, address] });
      const result = await apiCall('/wallet/link', 'POST', { message: nonce.message, signature }, true);
      setLinked(result.address);
      setStatus('Wallet linked. No funds or approvals requested.');
    } catch (error: any) {
      setStatus(error?.code === 4001 ? 'Request rejected.' : error?.message || 'Wallet link failed.');
    }
  };

  return (
    <section className="glass-card testnet-wallet-card">
      <div className="card-header"><div><p className="eyebrow">Self-custody testnet</p><h3>Base Sepolia wallet</h3></div><Wallet aria-hidden="true" /></div>
      <p><ShieldCheck size={15} aria-hidden="true" /> Testnet only. Tokens have no value. ReimonDev Games never asks for seed phrases or private keys.</p>
      {linked ? <a href={`https://sepolia.basescan.org/address/${linked}`} target="_blank" rel="noreferrer"><Link size={14} /> {linked.slice(0, 6)}...{linked.slice(-4)}</a> : <button type="button" className="secondary-button" onClick={connect}>Connect and sign</button>}
      <span role="status">{status}</span>
    </section>
  );
}
