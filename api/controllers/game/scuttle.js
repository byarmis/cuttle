module.exports = function (req, res) {
  const promiseGame = gameService.findGame({ gameId: req.session.game });
  const promisePlayer = userService.findUser({ userId: req.session.usr });
  const promiseOpponent = userService.findUser({ userId: req.body.opId });
  const promiseCard = cardService.findCard({ cardId: req.body.cardId });
  const promiseTarget = cardService.findCard({ cardId: req.body.targetId });
  Promise.all([promiseGame, promisePlayer, promiseOpponent, promiseCard, promiseTarget])
    .then(function changeAndSave(values) {
      const [game, player, opponent, card, target] = values;
      if (game.turn % 2 !== player.pNum) {
        return Promise.reject({ message: "It's not your turn." });
      }
      if (card.hand !== player.id) {
        return Promise.reject({ message: 'You can only play a card that is in your hand' });
      }
      if (target.points !== opponent.id) {
        return Promise.reject({
          message: 'You can only scuttle a card your opponent has played for points',
        });
      }
      if (card.rank < target.rank || (card.rank === target.rank && card.suit < target.suit)) {
        return Promise.reject({
          message:
            "You can only scuttle an opponent's point card with a higher rank point card, or the same rank with a higher suit. Suit order (low to high) is: Clubs < Diamonds < Hearts < Spades",
        });
      }
      if (player.frozenId === card.id) {
        return Promise.reject({ message: 'That card is frozen! You must wait a turn to play it.' });
      }
      // Move is legal; make changes
      const attachmentIds = target.attachments.map((card) => card.id);
      const logMessage = `${player.username} scuttled ${opponent.username}'s ${target.name} with the ${card.name}`;
      // Define update dictionaries
      const gameUpdates = {
        passes: 0,
        turn: game.turn + 1,
        log: [...game.log, logMessage],
        lastEvent: {
          change: 'scuttle',
        },
      };
      const playerUpdates = {
        frozenId: null,
      };
      return sails.getDatastore().transaction((db) => {
        // Consolidate update promises into array
        const updatePromises = [
          // Include game record so it can be retrieved downstream
          game,
          // Updates to game record e.g. turn
          Game.updateOne(game.id).set(gameUpdates).usingConnection(db),
          // Updates to player record i.e. frozenId
          User.updateOne(player.id).set(playerUpdates).usingConnection(db),
          // Clear target's attachments
          Card.replaceCollection(target.id, 'attachments').members([]).usingConnection(db),
          // Remove card from player's hand
          User.removeFromCollection(player.id, 'hand').members([card.id]).usingConnection(db),
          // Remove target from opponent's points
          User.removeFromCollection(opponent.id, 'points').members([target.id]).usingConnection(db),
          // Scrap cards
          Game.addToCollection(game.id, 'scrap')
            .members([...attachmentIds, card.id, target.id])
            .usingConnection(db),
        ];
        return Promise.all(updatePromises);
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
          change: 'scuttle',
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
