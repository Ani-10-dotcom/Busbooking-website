const { createBooking, handler } = require('../../lib/core');
module.exports = handler(['POST'], ({ body }) => createBooking(body));
