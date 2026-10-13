const { meta, handler } = require('../lib/core');
module.exports = handler(['GET'], async () => meta());
