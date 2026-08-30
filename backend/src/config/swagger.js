/**
 * src/config/swagger.js
 * Swagger/OpenAPI configuration for Stellar MarketPay API
 */

const swaggerJsdoc = require("swagger-jsdoc");
const { swaggerOptions } = require("./swaggerOptions");

const specs = swaggerJsdoc(swaggerOptions);

module.exports = specs;
