module.exports = function (req, res) {
  const promiseGame = gameService.findGame({ gameId: req.session.game });
  const promisePlayer = userService.findUser({ userId: req.session.usr });
  const promiseCard = cardService.findCard({ cardId: req.body.cardId });
  Promise.all([promiseGame, promisePlayer, promiseCard])
    .then(function changeAndSave(values) {
      const [game, player, card] = values;
      if (game.turn % 2 === player.pNum) {
        if (card.hand === player.id) {
          if ((card.rank >= 12 && card.rank <= 13) || card.rank === 8) {
            if (player.frozenId !== card.id) {
              // Everything okay; make changes
              let logEntry = `${player.username} played the ${card.name}`;
              if (card.rank === 8) {
                logEntry += ' as a Glasses eight';
              }
              const gameUpdates = {
                turn: game.turn + 1,
                log: [...game.log, logEntry],
                passes: 0,
                lastEvent: {
                  change: 'faceCard',
                },
              };

              const playerUpdates = {
                frozenId: null,
              };

              return sails.getDatastore().transaction((db) => {
                const updatePromises = [
                  Game.updateOne({ id: game.id }).set(gameUpdates).usingConnection(db),
                  User.updateOne({ id: player.id }).set(playerUpdates).usingConnection(db),
                  User.removeFromCollection(player.id, 'hand').members(card.id).usingConnection(db),
                  User.addToCollection(player.id, 'faceCards').members(card.id).usingConnection(db),
                ];

                return Promise.all([game, ...updatePromises]);
              });
            }
            return Promise.reject({
              message: 'That card is frozen! You must wait a turn to play it',
            });
          }
          return Promise.reject({
            message: 'Only Kings, Queens, and Eights may be played as Face Cards without a target',
          });
        }
        return Promise.reject({ message: 'You can only play a card that is in your hand.' });
      }
      return Promise.reject({ message: "It's not your turn." });
    })
    .then(function populateGame(values) {
      const game = values[0];
      return sails.getDatastore().transaction((db) => {
        return Promise.all([
          gameService.populateGame({ gameId: game.id }).usingConnection(db),
          game,
        ]);
      });
    })
    .then(async function publishAndRespond(values) {
      const fullGame = values[0];
      const gameModel = values[1];
      const victory = await gameService.checkWinGame({
        game: fullGame,
        gameModel,
      });
      Game.publish([fullGame.id], {
        verb: 'updated',
        data: {
          change: 'faceCard',
          game: fullGame,
          victory,
        },
      });
      // If the game is over, clean it up
      if (victory.gameOver) await gameService.clearGame({ userId: req.session.usr });
      return res.ok();
    })
    .catch(function failed(err) {
      return res.badRequest(err);
    });
};
