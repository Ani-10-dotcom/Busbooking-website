const { getBooking, handler } = require('../../lib/core');
// Path: /api/bookings/<bookingId>?phone=<mobile>
module.exports = handler(['GET'], ({ query, path }) => getBooking(decodeURIComponent(path.split('/')[3] || ''), query));
