module.exports = function (req, res) {
  const game = gameService.findGame({ gameId: req.session.game });
  const player = userService.findUser({ userId: req.session.usr });
  const opponent = userService.findUser({ userId: req.body.opId });
  const card = cardService.findCard({ cardId: req.body.cardId });
  const target = cardService.findCard({ cardId: req.body.targetId });
  Promise.all([game, player, opponent, card, target]) // fixed
    .then(function changeAndSave(values) {
      const [game, player, opponent, card, target] = values;
      if (game.turn % 2 === player.pNum) {
        if (card.hand === player.id) {
          if (card.rank === 11) {
            if (target.points === opponent.id) {
              const queenCount = userService.queenCount({ user: opponent });
              if (queenCount === 0) {
                if (player.frozenId !== card.id) {
                  // Valid move; change and save
                  const gameUpdates = {
                    log: [
                      ...game.log,
                      `${player.username} stole ${opponent.username}'s ${target.name} with the ${card.name}`,
                    ],
                    turn: game.turn + 1,
                    passes: 0,
                    lastEvent: {
                      change: 'jack',
                    },
                  };
                  const playerUpdates = {
                    frozenId: null,
                  };
                  const cardUpdates = {
                    index: target.attachments.length,
                  };

                  return sails.getDatastore().transaction((db) => {
                    const updatePromises = [
                      Game.updateOne(game.id).set(gameUpdates).usingConnection(db),
                      User.updateOne(player.id).set(playerUpdates).usingConnection(db),
                      User.addToCollection(player.id, 'points')
                        .members([target.id])
                        .usingConnection(db),
                      User.removeFromCollection(player.id, 'hand')
                        .members([card.id])
                        .usingConnection(db),
                      Card.updateOne(card.id).set(cardUpdates).usingConnection(db),
                      Card.addToCollection(target.id, 'attachments')
                        .members([card.id])
                        .usingConnection(db),
                    ];
                    return Promise.all([game, ...updatePromises]); //fixed
                  });
                }
                return Promise.reject({
                  message: 'That card is frozen! You must wait a turn to play it',
                });
              }
              return Promise.reject({
                message: 'You cannot use a Jack while your opponent has a Queen.',
              });
            }
            return Promise.reject({
              message: "You can only play a Jack on an opponent's Point card.",
            });
          }
          return Promise.reject({
            message: "You can only use a Jack to steal an opponent's Point card",
          });
        }
        return Promise.reject({ message: 'You can only play a card that is in your hand' });
      }
      return Promise.reject({ message: "It's not your turn" });
    }) //End changeAndSave()
    .then(function populateGame(values) {
      const game = values[0];
      return sails.getDatastore().transaction((db) => {
        return Promise.all([
          gameService.populateGame({ gameId: game.id }).usingConnection(db),
          game,
        ]); //fixed
      });
    })
    .then(async function publishAndRespond(values) {
      const [fullGame, gameModel] = values;
      const victory = await gameService.checkWinGame({
        game: fullGame,
        gameModel,
      });

      Game.publish([fullGame.id], {
        verb: 'updated',
        data: {
          change: 'jack',
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
