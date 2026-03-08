require("dotenv").config();
const app = require("./app");
const logger = require("./services/logger");

require("./workers/deliveryWorker");

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  logger.info(` Server running on http://localhost:${PORT}`);
  logger.info(` Delivery worker running`);
});
