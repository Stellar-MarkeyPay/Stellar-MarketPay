import { test } from "@playwright/test";

test("debug page.route interception", async ({ page }) => {
  // Register a catch-all for the test endpoint
  await page.route("**/api/test*", async (route) => {
    console.log("[MOCK ROUTE]", route.request().method(), route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ mock: true }),
    });
  });

  page.on("request", (req) => {
    if (req.url().includes("/api/test")) {
      console.log("[REQUEST]", req.method(), req.url());
    }
  });

  page.on("response", async (res) => {
    if (res.url().includes("/api/test")) {
      const body = await res.text();
      console.log("[RESPONSE]", res.status(), res.url(), body.substring(0, 200));
    }
  });

  await page.goto("http://localhost:3000/");
  
  // Make fetch request via evaluate
  const result = await page.evaluate(async () => {
    try {
      const res = await fetch("http://localhost:4000/api/test-endpoint");
      const data = await res.json();
      return { ok: true, data: JSON.stringify(data) };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });
  console.log("[FETCH RESULT]", JSON.stringify(result));
  
  // Make XHR request via evaluate
  const xhrResult = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", "http://localhost:4000/api/test-xhr");
      xhr.onload = () => {
        resolve({ status: xhr.status, body: xhr.responseText });
      };
      xhr.onerror = () => {
        resolve({ error: "XHR failed" });
      };
      xhr.send();
    });
  });
  console.log("[XHR RESULT]", JSON.stringify(xhrResult));
});
