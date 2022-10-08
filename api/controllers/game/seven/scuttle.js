module.exports = function (req, res) {
  const promiseGame = gameService.findGame({ gameId: req.session.game });
  const promisePlayer = userService.findUser({ userId: req.session.usr });
  const promiseOpponent = userService.findUser({ userId: req.body.opId });
  const promiseCard = cardService.findCard({ cardId: req.body.cardId });
  const promiseTarget = cardService.findCard({ cardId: req.body.targetId });
  Promise.all([promiseGame, promisePlayer, promiseOpponent, promiseCard, promiseTarget]) // fixed
    .then(function changeAndSave(values) {
      const [game, player, opponent, card, target] = values;
      if (game.turn % 2 === player.pNum) {
        if (card.id === game.topCard.id || card.id === game.secondCard.id) {
          if (card.rank < 11) {
            if (target.points === opponent.id) {
              if (
                card.rank > target.rank ||
                (card.rank === target.rank && card.suit > target.suit)
              ) {
                // Move is legal; make changes
                const { topCard, secondCard, cardsToRemoveFromDeck } = gameService.sevenCleanUp({
                  game: game,
                  index: req.body.index,
                });
                const cardsToScrap = [
                  card.id,
                  target.id,
                  ...target.attachments.map((jack) => jack.id),
                ];
                const gameUpdates = {
                  topCard,
                  secondCard,
                  passes: 0,
                  turn: game.turn + 1,
                  resolving: null,
                  log: [
                    ...game.log,
                    `${player.username} scuttled ${opponent.username}'s ${target.name} with the ${card.name} from the top of the deck.`,
                  ],
                  lastEvent: {
                    change: 'sevenScuttle',
                  },
                };
                return sails.getDatastore().transaction((db) => {
                  const updatePromises = [
                    Game.updateOne(game.id).set(gameUpdates).usingConnection(db),
                    // Remove new secondCard from deck
                    Game.removeFromCollection(game.id, 'deck')
                      .members(cardsToRemoveFromDeck)
                      .usingConnection(db),
                    // Remove target from opponent points
                    User.removeFromCollection(opponent.id, 'points')
                      .members([target.id])
                      .usingConnection(db),
                    // Remove attachments from target
                    Card.replaceCollection(target.id, 'attachments')
                      .members([])
                      .usingConnection(db),
                    // Scrap relevant cards
                    Game.addToCollection(game.id, 'scrap')
                      .members(cardsToScrap)
                      .usingConnection(db),
                  ];
                  return Promise.all([game, ...updatePromises]); // fixed
                });
              }
              return Promise.reject({
                message:
                  "You can only scuttle if your card's rank is higher, or the rank is the same, and your suit is higher (Clubs < Diamonds < Hearts < Spades)",
              });
            }
            return Promise.reject({
              message: "You can only scuttle a card in your oppponent's points",
            });
          }
          return Promise.reject({ message: 'You can only scuttle with an ace through ten' });
        }
        return Promise.reject({
          message: 'You can only one of the top two cards from the deck while resolving a seven',
        });
      }
      return Promise.reject({ message: "It's not your turn" });
    }) //End changeAndSave()
    .then(function populateGame(values) {
      return sails.getDatastore().transaction((db) => {
        return Promise.all([
          gameService.populateGame({ gameId: values[0].id }).usingConnection(db),
          values[0],
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
          change: 'sevenScuttle',
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
