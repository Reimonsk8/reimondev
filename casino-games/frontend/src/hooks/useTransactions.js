import { useState, useEffect } from 'react';
import { apiCall } from '../utils/api';

export function useTransactions(userId) {
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (userId) {
            fetchTransactions();
        }
    }, [userId]);

    const fetchTransactions = async (params = {}) => {
        try {
            setLoading(true);
            const queryParams = new URLSearchParams();
            if (params.limit) queryParams.append('limit', params.limit);
            if (params.startDate) queryParams.append('startDate', params.startDate);
            if (params.endDate) queryParams.append('endDate', params.endDate);

            const queryString = queryParams.toString();
            const endpoint = `/wallet/transactions${queryString ? `?${queryString}` : ''}`;

            const result = await apiCall(endpoint, "GET", null, true);
            setTransactions(result.transactions || []);
        } catch (err) {
            console.error("Failed to load transactions:", err);
        } finally {
            setLoading(false);
        }
    };

    return {
        transactions,
        loading,
        refreshTransactions: fetchTransactions,
    };
}
