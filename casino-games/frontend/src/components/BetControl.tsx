
import React, { useId } from 'react';
import { chipFly } from '../utils/fx';

interface BetControlProps {
    betAmount: number;
    setBetAmount: (amount: number) => void;
    disabled?: boolean;
}

const CHIP_VALUES = [5, 10, 25, 50, 100, 250];

export default function BetControl({ betAmount, setBetAmount, disabled = false }: BetControlProps) {
    const amountId = useId();

    const getChipColor = (value: number) => {
        switch (value) {
            case 5: return 'chip-blue';
            case 10: return 'chip-red';
            case 25: return 'chip-green';
            case 50: return 'chip-gold';
            case 100: return 'chip-purple';
            case 250: return 'chip-black';
            default: return 'chip-blue';
        }
    };

    const handleChipClick = (value: number, e?: React.MouseEvent) => {
        if (!disabled) {
            chipFly(e?.clientX, e?.clientY);
            setBetAmount(value);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseFloat(e.target.value);
        setBetAmount(isNaN(val) ? 0 : val);
    };

    return (
        <div className="bet-control-container">
            <label className="form-label bet-control-label" htmlFor={amountId}>Bet Amount</label>

            <div className="bet-chips-row">
                {CHIP_VALUES.map((val) => (
                    <button
                        type="button"
                        key={val}
                        className={`bet-chip-button ${getChipColor(val)} ${betAmount === val ? 'active' : ''}`}
                        onClick={(e) => handleChipClick(val, e)}
                        disabled={disabled}
                        aria-pressed={betAmount === val}
                        aria-label={`Set bet to ${val}`}
                    >
                        {val}
                    </button>
                ))}
            </div>

            <div className="bet-input-wrapper">
                <input
                    id={amountId}
                    type="number"
                    step="0.01"
                    min="1"
                    value={betAmount || ''}
                    onChange={handleInputChange}
                    className="form-input bet-amount-input"
                    placeholder="Custom Amount"
                    disabled={disabled}
                />
            </div>
        </div>
    );
}
