const { requestListener } = require("../server");

module.exports = async (req, res) => requestListener(req, res);
