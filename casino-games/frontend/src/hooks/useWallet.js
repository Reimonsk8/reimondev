import { useState, useEffect } from 'react';
import { apiCall } from '../utils/api';
import { pushToast } from '../utils/toast';

export function useWallet(userId) {
    const [balance, setBalance] = useState(0);
    const [nickname, setNickname] = useState('Player');
    const [avatarImage, setAvatarImage] = useState(null);
    const [stats, setStats] = useState({
        totalGames: 0,
        totalWagered: 0,
        totalWins: 0,
        totalWon: 0,
        biggestWin: 0
    });
    const [loading, setLoading] = useState(false);
    const [fairness, setFairness] = useState(null);
    const [lastProof, setLastProof] = useState(null);

    useEffect(() => {
        if (userId) {
            fetchWalletData();
            apiCall('/wallet/bet', 'GET', null, true).then(setFairness).catch(() => {});
        }
    }, [userId]);

    const fetchWalletData = async () => {
        try {
            setLoading(true);
            const result = await apiCall("/wallet/profile", "GET", null, true);
            setBalance(result.currentBalance || 0);
            setNickname(result.nickname || (result.email ? result.email.split('@')[0] : 'Player'));
            setAvatarImage(result.avatarImage || null);
            setStats({
                totalGames: result.totalGames || 0,
                totalWagered: result.totalWagered || 0,
                totalWins: result.totalWins || 0,
                totalWon: result.totalWon || 0,
                biggestWin: result.biggestWin || 0
            });
        } catch (err) {
            console.error("Failed to load wallet:", err);
        } finally {
            setLoading(false);
        }
    };

    const updateBalance = async (amount, type = 'deposit') => {
        const pendingKey = `c888_wallet_operation_${userId}_${type}`;
        let pending;
        try { pending = JSON.parse(localStorage.getItem(pendingKey) || 'null'); } catch { pending = null; }
        const operationAmount = Number.isFinite(pending?.amount) ? pending.amount : amount;
        const idempotencyKey = pending?.idempotencyKey || crypto.randomUUID();
        localStorage.setItem(pendingKey, JSON.stringify({ amount: operationAmount, idempotencyKey }));
        try {
            setLoading(true);
            let result;
            const payload = { amount: operationAmount, idempotencyKey };

            if (type === 'deposit') {
                result = await apiCall("/wallet/deposit", "POST", payload, true);
            } else if (type === 'withdraw') {
                result = await apiCall("/wallet/withdraw", "POST", payload, true);
            }

            if (result && result.newBalance !== undefined) {
                localStorage.removeItem(pendingKey);
                setBalance(result.newBalance);
                await fetchWalletData(); // This will refresh stats too
                pushToast(`$${operationAmount} ${type === 'withdraw' ? 'withdrawn' : 'deposited'}`, 'success');
                return result;
            }
            return false;
        } catch (err) {
            if (err.statusCode && err.statusCode < 500) localStorage.removeItem(pendingKey);
            pushToast(`Failed to ${type}: ${err.message || 'please try again'}`, 'error');
            console.error(`Failed to ${type}:`, err);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    const placeBet = async (amount, side) => {
        try {
            setLoading(true);
            const commitment = fairness || await apiCall('/wallet/bet', 'GET', null, true);
            const clientSeedKey = `c888_client_seed_${userId}`;
            let clientSeed = localStorage.getItem(clientSeedKey);
            if (!clientSeed) {
                clientSeed = crypto.randomUUID();
                localStorage.setItem(clientSeedKey, clientSeed);
            }
            const result = await apiCall("/wallet/bet", "POST", {
                amount,
                side,
                clientSeed,
                serverSeedHash: commitment.serverSeedHash,
                idempotencyKey: crypto.randomUUID(),
            }, true);
            setFairness({ serverSeedHash: result.proof.nextServerSeedHash, nonce: result.proof.nonce + 1, algorithm: result.proof.algorithm });
            setLastProof({ ...result.proof, roundId: result.roundId, game: result.game, result: result.result });

            if (result && result.newBalance !== undefined) {
                setBalance(result.newBalance);
            }
            // Stats update happens server-side, so refreshing fetches the new correct values
            await fetchWalletData();
            if (result?.isWin) {
                pushToast(`You won $${result.winAmount}! 🎉`, 'win');
            } else if (result?.isWin === false) {
                pushToast(`You lost $${result.betAmount}.`, 'info');
            }
            return result;
        } catch (err) {
            if (err.statusCode === 409) {
                apiCall('/wallet/bet', 'GET', null, true).then(setFairness).catch(() => {});
            }
            pushToast(`Bet failed: ${err.message || 'please try again'}`, 'error');
            console.error("Failed to place bet:", err);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    return {
        balance,
        nickname,
        avatarImage,
        stats,
        loading,
        updateBalance,
        placeBet,
        refreshWallet: fetchWalletData,
        fairness,
        lastProof,
    };
}
