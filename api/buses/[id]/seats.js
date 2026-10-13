const { seats, handler } = require('../../../lib/core');
// Path: /api/buses/<busId>/seats
module.exports = handler(['GET'], ({ query, path }) => seats(decodeURIComponent(path.split('/')[3] || ''), query));
