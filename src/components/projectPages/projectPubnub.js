import React, { useState, useEffect, useRef } from 'react';
import PubNub from 'pubnub';
import '../../styles/ProjectPubnub.css';

// Initialize PubNub outside component to avoid re-initializing on render
const pubnub = new PubNub({
    subscribeKey: "sub-c-a3a333c2-49a9-11e7-a9cb-02ee2ddab7fe",
    publishKey: "pub-c-7278b534-0675-4727-964a-272b855b32c3",
    ssl: true,
    uuid: "user-" + Math.random().toString(36).substr(2, 9)
});

const ProjectPubnub = () => {
    const [inputValue, setInputValue] = useState(30);
    const [historyMessages, setHistoryMessages] = useState([]);
    const canvasRef = useRef(null);
    const [isPolling, setIsPolling] = useState(true);

    // Effect to subscribe and handle polling
    useEffect(() => {
        pubnub.subscribe({
            channels: ['test'],
            withPresence: true
        });

        // Polling function to fetch history
        const readHistory = () => {
            // Fetch last 41 messages
            pubnub.history(
                {
                    channel: 'test',
                    reverse: false,
                    count: 41,
                    stringifiedTimeToken: false,
                },
                (status, response) => {
                    if (!status.error && response && response.messages) {
                        setHistoryMessages(response.messages);
                    }
                }
            );
        };

        // Poll immediately and then every 500ms if polling is active
        // NOTE: Polling every 500ms is very frequent. 
        // In a real production app, we would listen to 'message' events from Subscribe 
        // instead of polling history constantly. However, preserving original logic for now.
        let intervalId;
        if (isPolling) {
            readHistory();
            intervalId = setInterval(readHistory, 500);
        }

        return () => {
            if (intervalId) clearInterval(intervalId);
            // We could unsubscribe here, but if the component unmounts/remounts quickly it might be better to stay subscribed?
            // pubnub.unsubscribeAll();
        };
    }, [isPolling]);


    // Effect to draw chart whenever historyMessages updates
    useEffect(() => {
        if (!canvasRef.current || historyMessages.length === 0) return;

        const c = canvasRef.current;
        const ctx = c.getContext('2d');

        // Ensure accurate sizing
        c.width = 450;
        c.height = 600;

        const data = historyMessages.map(msg => {
            return msg.entry;
        });

        const reversedData = [...data].reverse();
        const msgl = reversedData.length;

        // Draw Chart
        ctx.clearRect(0, 0, c.width, c.height);

        // Background - make it transparent or very subtle dark
        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.fillRect(0, 0, 450, 600);

        // Chart Area Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(40, 0, 400, 550);

        ctx.beginPath();
        ctx.moveTo(40, 550);

        // Grid lines and Y-axis labels
        for (let i = 0; i <= 10; i++) {
            // Soft grayscale bands keep the live chart within the eclipse palette.
            ctx.fillStyle = `rgba(220, 224, 232, ${0.025 + (i % 2) * 0.012})`;
            ctx.fillRect(40, 0 + (i * 50), 400, 50);

            // Horizontal lines
            ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
            ctx.fillRect(30, 50 + (i * 50), 410, 1);

            // Text values (50'C down to 0'C)
            ctx.font = "12px Roboto, Arial, sans-serif";
            ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
            ctx.fillText(`${50 - (i * 5)}'C`, 5, (i + 1) * 50);
        }

        // Bars and X-axis labels
        for (let i = 0; i < msgl && i < 41; i++) {
            const tempValue = parseFloat(reversedData[i]);
            // Avoid NaN drawing if message isn't a number
            if (isNaN(tempValue)) continue;

            const barHeight = (10 * tempValue) + 10 + (8 * Math.pow(-1, i));

            // Restrained silver bars against the dark chart surface.
            ctx.fillStyle = "rgba(205, 211, 222, 0.22)";

            ctx.fillRect(40 + (i * 10), 550 - (10 * tempValue), 4, barHeight);

            // X-axis number
            ctx.font = "10px Roboto, Arial, sans-serif";
            ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
            // Staggered text position
            ctx.fillText(`${i}`, 38 + (i * 10), 570 + (8 * Math.pow(-1, i)));
        }

        // Line graph on top
        for (let i = 0; i < msgl; i++) {
            const tempValue = parseFloat(reversedData[i]);
            if (isNaN(tempValue)) continue;

            const x = 40 + (10 * i) + 2; // +2 to center on bar width
            const y = 550 - (10 * tempValue);

            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);

            ctx.fillStyle = '#e4e7ee';
            ctx.fillRect(x - 2, y - 2, 4, 4);
        }
        ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

    }, [historyMessages]);


    const handlePost = () => {
        pubnub.publish({
            message: inputValue,
            channel: 'test',
            sendByPost: true,
            storeInHistory: true,
            meta: { "cool": "meta" }
        }, (status, response) => {
            if (status.error) {
                console.log(status);
            } else {
                // Post success
            }
        });
    };

    const handleStop = () => {
        setIsPolling(prev => !prev);
    };

    return (
        <div className="project-pubnub-container">
            <div className="opciones-panel">
                <span>Test Post Custom Temp'C value</span>
                <button className="butt" onClick={handlePost}>
                    Post
                </button>
                <input
                    type="number"
                    value={inputValue}
                    min="0"
                    max="55"
                    onChange={(e) => setInputValue(e.target.value)}
                />
                <button className="butt" onClick={handleStop}>
                    {isPolling ? "Stop" : "Resume"}
                </button>
            </div>

            <div className="pantalla-panel">
                <table className="layout-table">
                    <tbody>
                        <tr>
                            <td className="layout-td">
                                <h3>Time Older to Last</h3>
                                <div className="log-container">
                                    {[...historyMessages].reverse().map((msg, index) => {
                                        // Original: date[i] + " at <b>" + hour + ":" + min + ":" + sec + "</b>   data " + (msgl - i - 1) + " =<b>" + data[i] + "C"
                                        // msg.timetoken is 17-digit string usually, requires / 10000 for JS date
                                        const time = new Date(msg.timetoken / 10000);
                                        const dateStr = time.toDateString();
                                        const timeStr = time.toLocaleTimeString();

                                        // "data X" logic: 0 is newest. in original log it printed: (msgl - i - 1)
                                        // If we map reversed array, index 0 is newest.
                                        // Let's stick to simple list for now.

                                        return (
                                            <div key={msg.timetoken} style={{ borderBottom: '1px solid #ccc', padding: '2px' }}>
                                                {dateStr} at <b>{timeStr}</b> <br />
                                                data {index} = <b>{msg.entry}C</b>
                                            </div>
                                        )
                                    })}
                                </div>
                            </td>
                            <td className="layout-td">
                                <h3>Last Values Streamed</h3>
                                <canvas ref={canvasRef} className="canvas-chart">
                                    Your browser does not support the HTML5 canvas tag.
                                </canvas>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default ProjectPubnub;
