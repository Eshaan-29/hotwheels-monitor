import http from "http";

const port = Number(process.env.PORT) || 10000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Hot Wheels monitor running\n");
});

server.listen(port, () => {
  console.log(`HTTP server listening on port ${port}`);
});

import axios from "axios";
import { load } from "cheerio";
import * as cron from "node-cron";
import twilio from "twilio";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const RECIPIENTS = [
  process.env.YOUR_WHATSAPP_NUMBER,
  process.env.OTHER_WHATSAPP_NUMBER_1,
].filter(Boolean) as string[];

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID || "",
  process.env.TWILIO_AUTH_TOKEN || ""
);

interface Product {
  name: string;
  category: string;
  price: number;
  url: string;
  inStock: boolean;
  lastAlertTime: string;
}

let products: Product[] = [];

function loadProducts(): void {
  try {
    if (fs.existsSync("products.json")) {
      const data = fs.readFileSync("products.json", "utf-8");
      products = JSON.parse(data);
    }
  } catch (error) {
    products = [];
  }
}

function saveProducts(): void {
  fs.writeFileSync("products.json", JSON.stringify(products, null, 2));
}

function findProduct(name: string): Product | undefined {
  return products.find((p) => p.name === name);
}

function addProduct(product: Product): void {
  products.push(product);
  saveProducts();
}

function updateProduct(name: string, data: Partial<Product>): void {
  const index = products.findIndex((p) => p.name === name);
  if (index !== -1) {
    products[index] = { ...products[index], ...data };
    saveProducts();
  }
}

async function sendWhatsApp(message: string, url?: string): Promise<void> {
  try {
    if (!process.env.TWILIO_WHATSAPP_NUMBER || RECIPIENTS.length === 0) {
      console.log("⚠️ WhatsApp config missing");
      return;
    }

    const body = url ? `${message}\n\n🔗 ${url}` : message;

    for (const to of RECIPIENTS) {
      await client.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to,
        body,
      });
    }

    console.log("✅ WhatsApp Alert Sent");
  } catch (error) {
    console.log("⚠️ WhatsApp Alert Failed");
  }
}

async function scrapeHotWheels(): Promise<Product[]> {
  const results: Product[] = [];

  const listUrl =
    "https://www.firstcry.com/hotwheels/5/0/113?sort=popularity&q=ard-hotwheels&ref2=q_ard_hotwheels&asid=53241";
  console.log("🔍 Fetching Hot Wheels list page");

  try {
    const response = await axios.get(listUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      timeout: 10000,
    });

    const $ = load(response.data);

    const products_found: Product[] = [];

    // Broadly scan <li> elements that look like product tiles
    $("li").each((index: number, element: any) => {
      try {
        const $elem = $(element);

        const cls = ($elem.attr("class") || "").toLowerCase();
        if (
          !cls.includes("prod") &&
          !cls.includes("product") &&
          !cls.includes("list") &&
          !cls.includes("item")
        ) {
          return;
        }

        let name =
          $elem.find("h2, h3, h4, [class*='title']").first().text().trim() ||
          $elem.find("a[title]").first().attr("title") ||
          "";

        if (!name || name.length <= 3) return;

        let priceText = $elem
          .find("[class*='price'], [data-testid*='price'], .f-price")
          .first()
          .text()
          .trim();

        const price = parseFloat(priceText.replace(/[^\d.]/g, ""));
        if (!price || price <= 0) return;

        let url =
          $elem
            .find("a[href*='/product/'], a[href*='/p/']")
            .first()
            .attr("href") ||
          $elem.find("a").first().attr("href") ||
          "";

        products_found.push({
          name,
          category: "Hot Wheels",
          price,
          url: url && url.startsWith("http")
            ? url
            : url
            ? `https://www.firstcry.com${url}`
            : listUrl,
          inStock: true,
          lastAlertTime: new Date().toISOString(),
        });
      } catch {
        // Skip invalid item
      }
    });

    const unique = products_found.filter(
      (p, i, arr) => arr.findIndex((item) => item.name === p.name) === i
    );

    results.push(...unique);
    console.log(`  ✓ Found ${unique.length} items`);
  } catch (error) {
    console.log("⚠️ Error scraping Hot Wheels list page");
  }

  return results;
}

async function monitorHotWheels(): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log(
    `🚀 Hot Wheels Monitor Running at ${new Date().toLocaleTimeString(
      "en-IN"
    )}`
  );
  console.log("=".repeat(70));

  try {
    loadProducts();
    const found = await scrapeHotWheels();
    console.log(`\n📊 Total products found: ${found.length}\n`);

    for (const product of found) {
      try {
        const existing = findProduct(product.name);

        if (!existing) {
          console.log(`\n🆕 NEW PRODUCT FOUND!`);
          console.log(`   Name: ${product.name}`);
          console.log(`   Category: ${product.category}`);
          console.log(`   Price: ₹${product.price}`);

          addProduct(product);

          await sendWhatsApp(
            `🎉 *NEW ${product.category.toUpperCase()}!*\n\n${product.name}\n\n💰 Price: ₹${product.price}`,
            product.url
          );
        }
        // no price-drop branch
      } catch (error) {
        console.log("⚠️ Error processing");
      }
    }

    console.log("\n✅ Monitor cycle complete!\n");
  } catch (error) {
    console.error("❌ Monitor Error:", error);
  }

  console.log("\n✅ Monitor cycle complete!\n");
}

console.log("🚀 Starting Hot Wheels Monitor...\n");
monitorHotWheels();

cron.schedule("*/5 * * * *", () => {
  monitorHotWheels();
});

console.log("⏰ Monitor running every 5 minutes...");
console.log("📦 Monitoring: Hot Wheels list page");
console.log("📱 Alerts: WhatsApp enabled");
console.log("💾 Database: products.json\n");

process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down...");
  process.exit(0);
});
