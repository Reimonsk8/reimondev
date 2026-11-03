import Modal from './Modal';
import CloseButton from './CloseButton';

export default function OnlinePlayersModal({ players = [], onlinePlayers = 0, onClose }) {
    return (
        <Modal
            isOpen
            onClose={onClose}
            title={`Online Players (${onlinePlayers})`}
            body=""
            type="info"
            isGame={false}
            variant="players"
        >
            <div className="online-players">
                {players.length > 0 ? (
                    <div className="online-players-list">
                        {players.map((player) => (
                            <div key={player.userId} className="player-directory-item">
                                <span className={`status-dot ${player.status}`} />
                                <div>
                                    <p>{player.nickname}</p>
                                    <small>{player.status}</small>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="empty-state">No players found.</p>
                )}
                <div className="online-players-close">
                    <CloseButton onClick={onClose} />
                </div>
            </div>
        </Modal>
    );
}
