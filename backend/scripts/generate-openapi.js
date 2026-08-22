/**
 * scripts/generate-openapi.js
 * Script to generate OpenAPI specification from JSDoc annotations
 */

const fs = require("fs");
const path = require("path");
const swaggerJsdoc = require("swagger-jsdoc");
const { swaggerOptions } = require("../src/config/swaggerOptions");

function generateOpenApiSpec() {
  try {
    console.log("Generating OpenAPI specification...");

    // Generate the specification
    const specs = swaggerJsdoc(swaggerOptions);

    // Ensure docs directory exists
    const docsDir = path.join(__dirname, "..", "docs");
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true });
    }

    // Write the OpenAPI specification to file
    const outputPath = path.join(docsDir, "openapi.json");
    fs.writeFileSync(outputPath, JSON.stringify(specs, null, 2));

    console.log(`OpenAPI specification generated successfully: ${outputPath}`);
    console.log(`Found ${Object.keys(specs.paths || {}).length} API paths`);

    // Print summary of documented endpoints
    const paths = specs.paths || {};
    const endpointCount = Object.keys(paths).length;
    const methodCount = Object.values(paths).reduce((total, path) => {
      return (
        total +
        Object.keys(path).filter((key) => ["get", "post", "put", "patch", "delete"].includes(key))
          .length
      );
    }, 0);

    console.log(`Documentation summary:`);
    console.log(`- ${endpointCount} unique endpoints`);
    console.log(`- ${methodCount} total HTTP methods`);

    // Check for undocumented routes - fails the build on drift
    checkForUndocumentedRoutes();
  } catch (error) {
    console.error("Error generating OpenAPI specification:", error);
    process.exit(1);
  }
}

function checkForUndocumentedRoutes() {
  console.log("\nChecking for undocumented routes...");

  const routesDir = path.join(__dirname, "..", "src", "routes");
  const routeFiles = fs
    .readdirSync(routesDir)
    .filter((file) => file.endsWith(".js") && !file.endsWith(".test.js"));

  let undocumentedCount = 0;

  routeFiles.forEach((file) => {
    const filePath = path.join(routesDir, file);
    const content = fs.readFileSync(filePath, "utf8");

    // Look for router.get, router.post, etc. without @swagger comments
    const routeMatches = content.match(/router\.(get|post|put|patch|delete)\s*\(/g);
    const swaggerMatches = content.match(/@swagger/g);

    if (routeMatches && (!swaggerMatches || swaggerMatches.length < routeMatches.length)) {
      const undocumented = routeMatches.length - (swaggerMatches ? swaggerMatches.length : 0);
      undocumentedCount += undocumented;
      console.warn(`Warning: ${file} has ${undocumented} undocumented route(s)`);
    }
  });

  if (undocumentedCount === 0) {
    console.log("All routes appear to be documented! \u2705");
  } else {
    console.error(`Found ${undocumentedCount} undocumented routes across all files`);
    console.error("Add @swagger JSDoc annotations for every route before merging.");
    process.exit(1);
  }
}

// Run the generation
generateOpenApiSpec();
