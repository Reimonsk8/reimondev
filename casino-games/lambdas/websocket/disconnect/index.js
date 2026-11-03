const { docClient, PLAYER_ROOM, broadcast, listPlayers } = require('../utils');
const { handleDisconnect } = require('../blackjack');
const { handleDisconnect: handleSosDisconnect } = require('../sos');
const { handleDisconnect: handleLobbyDisconnect } = require('../lobby');

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;

  // Remove this connection's seat from the blackjack table before cleanup
  try {
    await handleDisconnect(connectionId);
  } catch (err) {
    console.warn('Blackjack disconnect cleanup (non-fatal):', err.message);
  }

  // Release any Square of Shadows seat so a closed tab cannot stall a duel
  try {
    await handleSosDisconnect(connectionId);
  } catch (err) {
    console.warn('SoS disconnect cleanup (non-fatal):', err.message);
  }

  const playerResult = await docClient.get({
    TableName: process.env.PLAYERS_TABLE_NAME,
    Key: { connectionId, roomId: PLAYER_ROOM },
  });

  const player = playerResult.Item;

  await docClient.delete({
    TableName: process.env.PLAYERS_TABLE_NAME,
    Key: { connectionId, roomId: PLAYER_ROOM },
  });

  await docClient.delete({
    TableName: process.env.CONNECTIONS_TABLE_NAME,
    Key: { connectionId },
  });

  if (player) {
    await broadcast({ type: 'playerLeft', playerId: player.playerId }, { exclude: connectionId });
    const players = await listPlayers();
    await broadcast({ type: 'snapshot', players });
  }

  // Roster push happens last: the players row is already gone, so this
  // broadcast is the first thing every lobby client sees without the leaver.
  try {
    await handleLobbyDisconnect(connectionId);
  } catch (err) {
    console.warn('Lobby disconnect cleanup (non-fatal):', err.message);
  }

  return { statusCode: 200, body: 'Disconnected' };
};
