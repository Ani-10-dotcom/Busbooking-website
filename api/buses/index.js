const { listBuses, handler } = require('../../lib/core');
module.exports = handler(['GET'], ({ query }) => listBuses(query));
