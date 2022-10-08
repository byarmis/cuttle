module.exports = function (req, res) {
  // Capture request data
  const p0HandCardIds = req.body.p0HandCardIds || [];
  const p0PointCardIds = req.body.p0PointCardIds || [];
  const p0FaceCardIds = req.body.p0FaceCardIds || [];
  const p1HandCardIds = req.body.p1HandCardIds || [];
  const p1PointCardIds = req.body.p1PointCardIds || [];
  const p1FaceCardIds = req.body.p1FaceCardIds || [];
  const scrapCardIds = req.body.scrapCardIds || [];
  const topCardId = req.body.topCardId || null;
  const secondCardId = req.body.secondCardId || null;
  // Aggregate list of all cards being requested
  const allRequestedCards = [
    ...p0HandCardIds,
    ...p0PointCardIds,
    ...p0FaceCardIds,
    ...p1HandCardIds,
    ...p1PointCardIds,
    ...p1FaceCardIds,
    ...scrapCardIds,
  ];
  if (topCardId) {
    allRequestedCards.push(topCardId);
  }
  if (secondCardId) {
    allRequestedCards.push(secondCardId);
  }

  // Find records
  const findGame = Game.findOne({ id: req.session.game }).populate('deck');
  const findP0 = User.findOne({ id: req.body.p0Id }).populateAll();
  const findP1 = User.findOne({ id: req.body.p1Id }).populateAll();

  return Promise.all([findGame, findP0, findP1])
    .then(function resetGame(values) {
      // Put all cards back in deck
      const [game, p0, p1] = values;

      const oldP0Hand = p0.hand.map((card) => card.id);
      const oldP0Points = p0.points.map((card) => card.id);
      const oldP0FaceCards = p0.faceCards.map((card) => card.id);
      const oldP1Hand = p1.hand.map((card) => card.id);
      const oldP1Points = p1.points.map((card) => card.id);
      const oldP1FaceCards = p1.faceCards.map((card) => card.id);
      const addToDeck = [
        game.topCard,
        game.secondCard,
        ...oldP0Hand,
        ...oldP0Points,
        ...oldP0FaceCards,
        ...oldP1Hand,
        ...oldP1Points,
        ...oldP1FaceCards,
      ];

      return sails.getDatastore().transaction((db) => {
        const updatePromises = [
          Game.addToCollection(game.id, 'deck').members(addToDeck).usingConnection(db),
          User.replaceCollection(p0.id, 'hand').members([]).usingConnection(db),
          User.replaceCollection(p0.id, 'points').members([]).usingConnection(db),
          User.replaceCollection(p0.id, 'faceCards').members([]).usingConnection(db),
          User.replaceCollection(p1.id, 'hand').members([]).usingConnection(db),
          User.replaceCollection(p1.id, 'points').members([]).usingConnection(db),
          User.replaceCollection(p1.id, 'faceCards').members([]).usingConnection(db),
        ];

        return Promise.all([game, p0, p1, ...updatePromises]);
      });
    })
    .then(function placeCards(values) {
      // Load game according to fixture
      const [game, p0, p1] = values;
      let topCard = null;
      let secondCard = null;
      // Take top card from fixture if specified
      if (topCardId) {
        topCard = topCardId;
      }
      // Otherwise select it randomly from remaining cards
      else {
        topCard = _.sample(game.deck).id;
        while (allRequestedCards.includes(topCard)) {
          topCard = _.sample(game.deck).id;
        }
        allRequestedCards.push(topCard);
      }
      // Take second card from fixture if specified
      if (secondCardId) {
        secondCard = secondCardId;
      }
      // Otherwise select it randomly from remaining cards
      else {
        secondCard = _.sample(game.deck).id;
        while (allRequestedCards.includes(secondCard)) {
          secondCard = _.sample(game.deck).id;
        }
        allRequestedCards.push(secondCard);
      }

      const gameUpdates = {
        topCard,
        secondCard,
      };

      return sails.getDatastore().transaction((db) => {
        const updatePromises = [
          Game.updateOne(game.id).set(gameUpdates).usingConnection(db),
          User.replaceCollection(p0.id, 'hand').members(p0HandCardIds).usingConnection(db),
          User.replaceCollection(p0.id, 'points').members(p0PointCardIds).usingConnection(db),
          User.replaceCollection(p0.id, 'faceCards').members(p0FaceCardIds).usingConnection(db),
          User.replaceCollection(p1.id, 'hand').members(p1HandCardIds).usingConnection(db),
          User.replaceCollection(p1.id, 'points').members(p1PointCardIds).usingConnection(db),
          User.replaceCollection(p1.id, 'faceCards').members(p1FaceCardIds).usingConnection(db),
          Game.replaceCollection(game.id, 'scrap').members(scrapCardIds).usingConnection(db),
          Game.removeFromCollection(game.id, 'deck').members(allRequestedCards).usingConnection(db),
        ];

        return Promise.all([game, ...updatePromises]);
      });
    })
    .then(function populateGame(values) {
      const [game] = values;
      return gameService.populateGame({ gameId: game.id });
    })
    .then(function publishAndRespond(game) {
      // Announce update through socket
      Game.publish([game.id], {
        verb: 'updated',
        data: {
          change: 'loadFixture',
          game,
        },
      });
      // Respond 200 OK
      return res.ok(game);
    })
    .catch(function handleError(err) {
      return res.badRequest(err);
    });
};
