module.exports = function (req, res) {
  const promiseGame = gameService.findGame({ gameId: req.session.game });
  const promisePlayer = userService.findUser({ userId: req.session.usr });
  const promiseCard = cardService.findCard({ cardId: req.body.cardId });
  Promise.all([promiseGame, promisePlayer, promiseCard])
    .then(function changeAndSave(values) {
      const [game, player, card] = values;
      const gameUpdates = {
        oneOff: null,
        resolving: null,
        passes: 0,
        turn: game.turn + 1,
        log: [
          ...game.log,
          `${player.username} took the ${card.name} from the Scrap pile to their hand.`,
        ],
        lastEvent: {
          change: 'resolveThree',
        },
      };
      return sails.getDatastore().transaction((db) => {
        const updatePromises = [
          // Update game
          Game.updateOne(game.id).set(gameUpdates).usingConnection(db),
          // Scrap the three that just resolved
          Game.addToCollection(game.id, 'scrap').members([game.oneOff.id]).usingConnection(db),
          // Return selected card to player's hand
          User.addToCollection(player.id, 'hand').members([card.id]).usingConnection(db),
          // Remove selected card from scrap
          Game.removeFromCollection(game.id, 'scrap').members([card.id]).usingConnection(db),
        ];
        return Promise.all([game, ...updatePromises]);
      });
    })
    .then(function populateGame(values) {
      const [game] = values;
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
          change: 'resolveThree',
          game: fullGame,
          victory,
        },
      });
      return res.ok();
    })
    .catch(function failed(err) {
      return res.badRequest(err);
    });
};
