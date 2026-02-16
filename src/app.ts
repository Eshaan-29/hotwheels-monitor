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

// MANUAL LIST: products you care about
const MONITORED_PRODUCTS = [
  {
    name: "Hot Wheels Die Cast Free Wheel Fat Ride Bike Green and Black",
    url: "https://www.firstcry.com/hot-wheels/hot-wheels-die-cast-free-wheel-fat-ride-bike-green-and-black/2232875/product-detail",
  },
];

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

// NEW: scrape specific product pages you listed
async function scrapeHotWheels(): Promise<Product[]> {
  const results: Product[] = [];

  for (const item of MONITORED_PRODUCTS) {
    try {
      console.log(`🔍 Checking: ${item.name}`);
      const response = await axios.get(item.url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        timeout: 10000,
      });

      const $ = load(response.data);

      // Try common price selectors on product page
      let priceText = $(
        "[class*='price'], [data-testid*='price'], .f-price, .our_price, .prod-price"
      )
        .first()
        .text()
        .trim();

      const price = parseFloat(priceText.replace(/[^\d.]/g, ""));

      if (!price || price <= 0) {
        console.log(`  ⚠️ No price found for ${item.name}`);
        continue;
      }

      // Optional: detect out-of-stock by text
      const pageText = $.text().toLowerCase();
      const inStock = !pageText.includes("out of stock");

      results.push({
        name: item.name,
        category: "Hot Wheels",
        price,
        url: item.url,
        inStock,
        lastAlertTime: new Date().toISOString(),
      });

      console.log(
        `  ✓ Price: ₹${price}, inStock: ${inStock ? "yes" : "no"}`
      );
    } catch (error) {
      console.log(`⚠️ Error checking ${item.name}`);
    }
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
    console.log(`\n📊 Total products checked: ${found.length}\n`);

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
        } else if (product.price < existing.price) {
          const discount = (
            ((existing.price - product.price) / existing.price) *
            100
          ).toFixed(1);

          console.log(`\n💰 PRICE DROP!`);
          console.log(`   Name: ${product.name}`);
          console.log(`   Old: ₹${existing.price}`);
          console.log(`   New: ₹${product.price}`);
          console.log(`   Discount: ${discount}%`);

          updateProduct(product.name, {
            price: product.price,
            lastAlertTime: new Date().toISOString(),
          });

          await sendWhatsApp(
            `💰 *PRICE DROP!*\n\n${product.name}\n\nOld: ₹${existing.price}\nNew: ₹${product.price}\n📉 ${discount}% Off`,
            product.url
          );
        }
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
console.log("📦 Monitoring: manual Hot Wheels product list");
console.log("📱 Alerts: WhatsApp enabled");
console.log("💾 Database: products.json\n");

process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down...");
  process.exit(0);
});
