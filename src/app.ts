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

const WISHLIST = [
  {
    name: "ferrari",
    keywords: [
      "ferrari",
      "f40",
      "f8",
      "488",
      "sf90",
      "f430",
      "laferrari",
      "testarossa",
      "portofino",
      "812",
      "california",
      "enzo",
    ],
  },
  {
    name: "Porsche",
    keywords: [
      "porsche",
      "911",
      "turbo",
      "gt",
      "carrera",
      "cayman",
      "boxster",
      "panamera",
      "cayenne",
      "macan",
      "rs",
      "rsr",
    ],
  },
  {
    name: "F1",
    keywords: [
      "formula",
      "f1",
      "formula 1",
      "mclaren",
      "red bull",
      "mercedes",
      "ferrari f1",
      "aston martin",
      "alpine",
      "haas",
      "williams",
    ],
  },
  {
    name: "Premium",
    keywords: [
      "premium",
      "collector",
      "vintage",
      "classic",
      "real riders",
      "metal base",
      "chrome",
      "collection",
    ],
  },
  {
    name: "Treasure Hunt",
    keywords: [
      "treasure hunt",
      "sth",
      "rare",
      "limited",
      "exclusive",
      "special edition",
      "chase",
    ],
  },
  {
    name: "Mustang",
    keywords: [
      "mustang",
      "ford mustang",
      "gt500",
      "shelby",
      "boss",
      "mach 1",
      "fastback",
    ],
  },
  {
    name: "Mazda",
    keywords: [
      "mazda",
      "rx-7",
      "rx7",
      "miata",
      "mx-5",
      "rx-8",
      "rx8",
      "speed3",
      "mazdaspeed",
      "rotary",
    ],
  },
  {
    name: "Lamborghini",
    keywords: [
      "lamborghini",
      "lambo",
      "aventador",
      "reventon",
      "gallardo",
      "murcielago",
      "diablo",
      "countach",
      "huracan",
      "urus",
      "sesto",
    ],
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

async function scrapeHotWheels(): Promise<Product[]> {
  const results: Product[] = [];

  for (const cat of WISHLIST) {
    try {
      const searchUrl = `https://www.firstcry.com/search?q=${encodeURIComponent(
        cat.name + " hotwheels"
      )}`;
      console.log(`🔍 Searching: ${cat.name}`);

      const response = await axios.get(searchUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        timeout: 10000,
      });

      const $ = load(response.data);

      const products_found: Product[] = [];

      $(
        '[data-testid="productCard"], [class*="productCard"], [class*="product-card"], div[class*="product"]'
      ).each((index: number, element: any) => {
        try {
          const $elem = $(element);

          let name = $elem
            .find("h2, h3, [class*='title']")
            .first()
            .text()
            .trim();

          if (!name) {
            name = $elem.find("a").first().attr("title") || "";
          }

          let priceText = $elem
            .find("[class*='price'], [data-testid*='price']")
            .first()
            .text()
            .trim();

          const price = parseFloat(priceText.replace(/[^\d.]/g, ""));

          let url =
            $elem.find("a[href*='/p/']").first().attr("href") ||
            $elem.find("a").first().attr("href") ||
            "";

                       // TEST MODE: accept every product with a valid price & name
          const matches = true; // force match for all items

          if (matches && price > 50 && name.length > 3) {
            products_found.push({
              name,
              category: cat.name,
              price,
              url: url.startsWith("http")
                ? url
                : `https://www.firstcry.com${url}`,
              inStock: true,
              lastAlertTime: new Date().toISOString(),
            });
          }


        } catch (e) {
          // Skip
        }
      });

      const unique = products_found.filter(
        (p, i, arr) => arr.findIndex((item) => item.name === p.name) === i
      );

      results.push(...unique);
      console.log(`  ✓ Found ${unique.length} items`);
    } catch (error) {
      console.log(`⚠️ Error scraping ${cat.name}`);
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
        console.log(`⚠️ Error processing`);
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
console.log(
  "📦 Monitoring: Ferrari, Porsche, F1, Premium, Treasure Hunt, Mustang, Mazda, Lamborghini"
);
console.log("📱 Alerts: WhatsApp enabled");
console.log("💾 Database: products.json\n");

process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down...");
  process.exit(0);
});
